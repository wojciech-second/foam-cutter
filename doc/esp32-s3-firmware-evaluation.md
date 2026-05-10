# ESP32-S3 Firmware Evaluation for the 4-Axis Hot-Wire Foam Cutter

**Project context.** Two CoreXY gantries, one at each end of the foam block, with a Nichrome wire stretched between them. Both gantries must travel in lockstep so that the wire stays straight as it passes through the foam. Hardware is an ESP32-S3 (dual-core Xtensa LX7 @ 240 MHz, native USB-OTG, RMT, MCPWM, I2S). The CAM (TS + Three.js) already produces paired sample sequences `(X1, Y1, X2, Y2, t)` and we want to drive the controller from the browser, not from a third-party G-code sender.

This evaluation surveys the candidate firmwares, then answers the three concrete questions: which firmware to use, whether their cores can be lifted into a custom ESP-IDF app, and whether our SPA can replace or live alongside FluidNC's WebUI.

---

## 1. Comparison table

| Firmware | ESP32-S3 | Max axes | CoreXY native | Custom kinematics | PWM hot-wire | Sender protocol | Web UI | Config | License | Active? |
|---|---|---|---|---|---|---|---|---|---|---|
| **FluidNC v4** | Yes (since v4.0.0, Jan 2024) | 6 (X,Y,Z,A,B,C); up to 2 motors/axis = 12 motors | Yes | Yes (`KinematicSystem` C++ subclass + `KinematicsFactory`) | Yes (PWM "spindle") | Grbl text protocol over USB-CDC, Telnet:23, WebSocket:81 (or :80 in v4.0.x), HTTP REST, WebDAV | ESP3D-WEBUI v2/v3 (Preact SPA, `index.html.gz` on LittleFS), replaceable | YAML on LittleFS at runtime, no recompile | GPL-3.0 | Very (v4.0.3 Apr 2024; >480 stars; Bart Dring + Mitch Bradley) |
| **grblHAL ESP32 driver** | Yes (`BOARD_GENERIC_S3`, `BOARD_GENERIC_I2S_S3`, `BOARD_MKS_DLC32_MAX_V1`) | 8 (`N_AXIS` 3-8, compile-time) | Yes (`kinematics/corexy.c`) | Yes (8 function-pointer struct) | Yes (PWM spindle plugin) | Grbl text over USB-CDC, Telnet, WebSocket | `Plugin_WebUI` serving ESP3D-WEBUI v2/v3 from FlashFS or SD | `my_machine.h` recompile + `$`-settings | Public domain / BSD-style core | Very (build 2025-05-22; Terje Io et al.) |
| **GRBL_ESP32** | No (original ESP32 only) | 3-6 | Yes (`Custom/CoreXY.cpp`) | Yes | Yes | Grbl text | ESP3D-WEBUI v2 | `config.h` recompile | GPL-3.0 | **Frozen** - succeeded by FluidNC; "All new features are targeted at FluidNC" |
| **Grbl-Mega-5X** | No (AVR ATmega2560) | 5/6 | No | Limited | Yes | Grbl serial | None | `config.h` recompile | GPL-3.0 | Slow; AVR planner code studied widely as reference |
| **Marlin 2.x** | Partial ESP32; **ESP32-S3 not officially supported** | 9 (`I_AXIS`-`W_AXIS`) | Yes (`COREXY`) | Yes (`FOAMCUTTER_XYUV` exists) | Yes | Marlin G-code | Octoprint/external | `Configuration.h` recompile | GPL-3.0 | Very (3D printer focus) |
| **Klipper** | **No** for ESP32-S3 (third-party `klipper_esp32` is experimental wrapper). Klipper requires a separate Linux host, can't run host+MCU on one S3. | 9+ | Yes | Yes (Python on host) | Yes | Klipper proprietary serial protocol; G-code via Moonraker | Mainsail/Fluidd (separate) | Python `printer.cfg` on host | GPL-3.0 | Very |
| **g2core / TinyG** | No ESP32 port | 9 (XYZABC+UVW) | Yes | Yes | Yes | Text JSON G-code | None | `settings_*.h` | MIT (g2core) | Slow |
| **Smoothieware / Smoothieware2** | No native ESP32 port (smoothie-nuttx exists but unmaintained) | 6+ | Yes | Yes (modules) | Yes | Smoothie | Pronterface/etc | `config.txt` runtime | GPL-3.0 | v2 dormant |
| **MachineKit / LinuxCNC HAL** | Host-side only (Linux PC + FPGA/parport). Excluded - won't run on an MCU. | n/a | n/a | n/a | n/a | n/a | n/a | n/a | LGPL-2.1 | Yes |
| **FastAccelStepper (gin66)** | Yes; ESP32-S3 supported via RMT (4 motors) or MCPWM/PCNT (4 motors, IDF 5.3+) | n/a (library) | n/a | n/a | n/a (you build it) | n/a | n/a | C++ API | MIT | Very |
| **AccelStepper / ESP-FlexyStepper** | Yes (Arduino-level) | n/a | n/a | n/a | n/a | n/a | n/a | C++ API | LGPL / MIT | Maintenance |

---

## 2. FluidNC - deep dive

FluidNC is the natural successor to Bart Dring's Grbl_Esp32 and the most relevant candidate.

**ESP32-S3 status.** v4.0.0 (Jan 2024) was the "First official release with ESP32-S3 Support"; v4.0.3 shipped Apr 2024. `BOARD_GENERIC_S3` and the wiki ESP32-S3 Pin Reference confirm S3 as a first-class target with native USB-CDC, MCPWM, and I2S stepping. The Jackpot board is a known-good S3 reference; V1E community threads confirm reliable production use through 2025-2026.

**Axis count.** `MAX_N_AXIS = 6`, `MAX_MOTORS_PER_AXIS = 2`, axis letters `X Y Z A B C`. 12 stepper outputs total, plenty for our 4-motor system. However, FluidNC names every motor against an axis letter; it does not natively model two independent CoreXY pairs - that's the modelling problem solved in Q1.

**Kinematics architecture.** `FluidNC/src/Kinematics/Kinematics.h` defines abstract `KinematicSystem`, registered via `KinematicsFactory` (a `GenericFactory<KinematicSystem>` template). Pure-virtual methods: `init`, `init_position`, `cartesian_to_motors(pl_data, target, position)`, `motors_to_cartesian`, `transform_cartesian_to_motors`. Optional overrides cover jogging, arc validation, homing, limit handling. Built-in subclasses: `Cartesian`, `CoreXY` (inherits Cartesian), `WallPlotter`, `ParallelDelta`. Selection by name in YAML.

The `CoreXY::cartesian_to_motors` does:
```cpp
motors[X] = x_scaler * cart[X] + cart[Y];
motors[Y] = x_scaler * cart[X] - cart[Y];
// motors[i>=2] = cart[i]  (passthrough Z,A,B,C)
// pl_data->feed_rate rescaled by motor_distance / cartesian_distance for non-rapid moves
```

This is precisely the entry point for a custom **TwoCoreXY** kinematics: treat `(X,Y)` as gantry 1 cartesian, `(A,B)` (or remapped `(U,V)`) as gantry 2 cartesian, run each through its own CoreXY mix. The planner still produces a single block whose step counts complete simultaneously across all 4 motors.

**Synchronized motion (the foam-cutter requirement).** FluidNC inherits Grbl's planner and Bresenham step engine:

```c
block->step_event_count = MAX(block->step_event_count, block->steps[axis]);
```

Every block runs for the time the dominant-axis steps need; slower axes interpolate via Bresenham; AMASS (Adaptive Multi-Axis Step Smoothing) refines low-rate axes by bit-shifting Bresenham counters. Two planner passes (reverse decel limits, forward accel limits) plus centripetal junction-deviation cornering. Net effect: *every axis arrives at the segment endpoint at the same instant by construction* - exactly the wire-stays-straight property we need.

**Stepping engines on S3.** `stepper_id_t` enum: `TIMED`, `RMT_ENGINE`, `I2S_STATIC`, `I2S_STREAM`. Step pulse timer @ 20 MHz. I2S_STREAM is the recommended engine (most efficient, supports many pins via shift registers); realistic top step rate ~100-125 kHz aggregate. RMT works for up to 4 steppers on S3 (4 channels vs. 8 on classic ESP32) - sufficient for our 4-motor case if using native GPIOs.

**Hot-wire PWM.** Wire is modelled as a `PWMSpindle`. Configure with `pwm_hz` (~5 kHz), `output_pin`, `enable_pin`, `s0_with_disable`, and a `speed_map` (e.g., `0=0% 255=100%`) to linearise wire-temperature vs. PWM duty. Multiple spindles allowed for auxiliary heaters. The Hackaday "FluidNC 4 axis foam cutter controller" (project #199287) drives a 1 m, 0.3 mm Nichrome wire @ 40 V using exactly this pattern.

**Web/API surface.**
- **HTTP/80**: serves `index.html.gz` from LittleFS; `/command?cmd=...` (gcode), `/files` (multipart POST to LittleFS), `/upload` (multipart POST to SD), `/sd/...`, `/flash/...` (WebDAV in v4).
- **WebSocket/81** (or /80 in v4.0.0/4.0.1): serial bridge via `Serial2Socket`. Send newline-terminated G-code lines, receive `ok`/`error` responses; realtime characters (`?`, `~`, `!`, `0x18`) flow byte-for-byte. Status reports look like `<Idle|MPos:...|FS:..|Bf:..|WCO:..>`. Same line buffer as USB-CDC/Telnet.
- **Multi-interface concurrency**: USB-CDC, Telnet:23, WebSocket all accept commands simultaneously; responses route to the originator. **Must respect Grbl flow control** (rx-buffer or character-counting).

**Web UI.** `index.html.gz` is a gzipped Preact SPA built from ESP3D-WEBUI; FluidNC ships a fork (michmela44/ESP3D-WEBUI tree `3.0-FluidNCDev`) with tablet mode and a G-code visualiser. **Replace by uploading any `index.html` / `index.html.gz` to LittleFS via `/files` - that completely replaces the default UI.** Re-flashing with `install-fs` restores the default.

**Config.** YAML on LittleFS, hot-edited via `/files` or `$Config/Filename=...`. No recompile needed for axes, motors, kinematics selection, spindles, pin maps. The single biggest practical advantage over grblHAL.

**License + maintenance.** GPL-3.0. v4.0.3 Apr 2024, fixes through 2025-2026 (USB Host, VFD, WebDAV). Two-person core team plus active community.

---

## 3. grblHAL - deep dive

grblHAL (Terje Io) is a modernised Grbl fork. The `grblHAL/core` repo holds pure motion-control logic; processor-specific code lives in driver repos (`grblHAL/ESP32`, STM32F4xx, iMXRT1062, etc.). The HAL is a struct of function pointers; boards fill them, and **plugins** (WebUI, modbus, networking, encoder, EEPROM) register the same way without editing core.

**ESP32-S3 status.** The driver supports S3. `main/my_machine.h` lists `BOARD_GENERIC_S3`, `BOARD_GENERIC_I2S_S3` (marked "untested - WIP" in earlier 2024 commits, more solid by 2025), `BOARD_MKS_DLC32_MAX_V1`, `BOARD_JACKPOT`. `sdkconfig.defaults.esp32s3` and `partitions_s3_8m.csv` exist. Native USB-CDC works; build switches sources by target. RMT on S3 supports 4 steppers (vs. 8 on classic ESP32) - same constraint as FluidNC.

**Axis count, kinematics, plugins.** `N_AXIS` configurable 3-8 in `config.h` (default 3). With `AXIS_REMAP_ABC2UVW`, axes 4-6 can be `U V W`. Kinematics interface is a struct of 8 function pointers: `transform_steps_to_cartesian`, `transform_from_cartesian`, `segment_line`, `limits_get_axis_mask`, `limits_set_target_pos`, `limits_set_machine_positions`, `homing_cycle_validate`, `homing_cycle_get_feedrate`. Built-ins: `corexy`, `wall_plotter`, `delta`, `polar`. Custom kinematics is a `.c` file that fills the struct and registers.

**Synchronized motion.** Same Grbl planner ancestry as FluidNC: `step_event_count = MAX(steps[axis])`, Bresenham step ISR, AMASS-equivalent. All axes finish each block simultaneously.

**Web/API.** `Plugin_WebUI` serves ESP3D-WEBUI v2/v3 over HTTP/80 + WebSocket/81 (settings `$306`, `$307`). File upload to FlashFS or SD `www/`. CORS not explicitly configured. Custom UIs supported (`grblTouch` etc.).

**Config.** Hybrid: compile-time `my_machine.h` + driver `config.h` for board/features, runtime `$`-settings in NVS for steps/mm, accelerations, kinematics parameters. Less hot-reloadable than FluidNC's YAML.

**License + maintenance.** Core treated as GPL-3.0 in practice (Grbl ancestry). Active: build 20250518; ~480 stars, 569 commits on `grblHAL/core`.

---

## 4. Other candidates - one-paragraph each

**GRBL_ESP32 (bdring)** - the original ESP32 port. Bart Dring redirected new development to FluidNC ("All new features are targeted at FluidNC"). No ESP32-S3 support. Use only as historical reference; the planner is the same Grbl code FluidNC inherits.

**Grbl-Mega-5X (fra589)** - AVR ATmega2560 only. 5/6-axis variant with the foam-cutter use case as a motivating example (issue #6). The widely-used "GRBL HotWire" firmware (rcKeith) is built on this. Useless on our chip.

**Marlin 2.x** - ESP32 port exists but ESP32-S3 is not in the list of officially-supported environments. Has a `FOAMCUTTER_XYUV` kinematics mode (X,U parallel horizontal, Y,V vertical) co-developed with rcKeith - exactly our topology, except Marlin treats it as single-gantry-with-two-ends rather than two-CoreXY. Large, heavily 3D-printer-flavoured, off the trodden path on S3.

**Klipper** - splits into a Linux host (kinematics + look-ahead) and MCU firmware (pure step output). Does not target ESP32-S3 as MCU and cannot run host+MCU on one chip - the host needs Linux. `klipper_esp32` is an experimental third-party wrapper, not viable.

**g2core / TinyG** - ARM (SAM3X / Synthetos v9), no ESP32 port. Most polished jerk-controlled planner, but not on our chip.

**Smoothieware / Smoothieware2** - LPC1768 native; `smoothie-nuttx` ESP32 experiment is dormant. Not viable.

**MachineKit / LinuxCNC** - Linux-only realtime; not an MCU firmware.

**FastAccelStepper (gin66)** - production-grade C++ stepper library; supports ESP32-S3 via RMT (4 motors) or MCPWM/PCNT (4 motors, IDF 5.3+), up to 200 kHz steps with accel ramps. It is *not* a CNC firmware: no planner, no G-code, no kinematics, no UI. A primitive for the roll-your-own route.

**AccelStepper / ESP-FlexyStepper / ESP-StepperMotor-Server** - older Arduino-style libraries; single-axis-oriented, no coordinated multi-axis planner.

**MotorGo** - ESP32-S3 board ecosystem geared toward BLDC FOC, not stepper CNC. Not relevant.

---

## 5. Q1. Best firmware for our system

**Recommendation: FluidNC v4 with a custom `TwoCoreXY` kinematics class, the hot wire wired as a PWM `spindle`, and our SPA replacing `index.html.gz` on LittleFS.**

Reasoning:

1. **ESP32-S3 is first-class** in v4 (Jan 2024 onwards, hardened through 2025-2026). Native USB-CDC, MCPWM, RMT, I2S are all wired through FluidNC's stepping engines.

2. **Two-CoreXY-gantry is a clean fit for FluidNC's kinematics extensibility.** Subclass `Cartesian` (or `CoreXY`), override `cartesian_to_motors` to apply the CoreXY mix to `(X,Y)` and again to `(A,B)`. YAML still lists 4 motors. The `pl_data->feed_rate` rescaling in the stock CoreXY is the reference - we'd average the cartesian-to-motor distance ratios across both ends. ~150-300 lines of C++ in a new `TwoCoreXY.{h,cpp}` file plus one-line factory registration. Far simpler than rolling our own planner.

3. **Constant-time arrival is built in.** `step_event_count = MAX(steps[axis])` plus Bresenham guarantees every axis (= both gantries' 4 motors) finishes each block at the same instant. That is the wire-stays-straight property.

4. **Hot-wire PWM is a one-line config** as a `PWMSpindle` with a `speed_map`. Modulate mid-cut via `S` words like a laser.

5. **YAML lets us iterate without firmware rebuilds** - steps/mm, accel, speed map, pin maps. Only the kinematics plugin requires a rebuild, and rarely.

6. **We commandeer the web stack.** SPA at `index.html.gz` on LittleFS; HTTP/WebSocket gives us streamed G-code in, status out, SD/LittleFS storage. No third-party sender needed.

7. **License.** GPL-3.0 firmware; our SPA stays independent. Embedding parts of FluidNC into a custom ESP-IDF app (Q2) inherits GPL-3.0 - acceptable for a community-shared foam cutter.

The strongest alternative is **grblHAL with a custom kinematics .c file** - same planner pedigree, more axes (8 vs 6). FluidNC wins on (a) better S3 polish in 2025-2026, (b) YAML-runtime config, (c) richer documented Web/SPA story (WebDAV, `/files` REST), and (d) an existing foam-cutter precedent (Hackaday #199287, rcKeith ecosystem).

Not recommended: Klipper (no host+MCU on one chip), Marlin (S3 unsupported, 3D-printer-flavoured), roll-your-own from FastAccelStepper (see Q2).

---

## 6. Q2. Can we lift the planner / step generator / kinematics into our own firmware?

Mostly yes for kinematics, no for the rest. The realistic plan is to **fork FluidNC and add our plugin**, not strip-mine the source.

**Pluggable cleanly.** Kinematics: subclass `KinematicSystem`, register via `KinematicsFactory`, no core changes. Spindles: same via `GenericFactory<SpindleBase>` - a custom hot-wire driver with PID/current-sense is a clean plugin. Modules system for ancillary tick loops.

**Tightly coupled.** The planner (`Planner.cpp`) and step generator (`Stepper.cpp` + `Stepping.cpp`) are not split across a clean abstraction boundary. They depend on `MachineConfig`, `Axes`, `Spindles`, `Limits`, `Probe`, the `Settings` system, `MotionControl`, and global state (`sys`, `sys_position`, the protocol state machine). Lifting just the planner into a custom ESP-IDF app would require porting all of that - effectively re-implementing FluidNC. The YAML-driven Configurable/Handler/Factory tree is pervasive; you don't lift out one piece without dragging it in. Stepping engines assume the global `Steppers` instance and FluidNC's `Pin` abstraction (`gpio.4:high:pu` syntax).

**grblHAL is more modular but the trade still loses.** grblHAL's HAL *is* the plug-in surface, and `grblHAL/core` is clean C with no driver deps - one could write a tiny ESP-IDF driver that fills the HAL function pointers. But (a) we lose FluidNC's YAML config, (b) we own the driver layer (USB, networking, FS, stepping) ourselves, and (c) hot-wire and kinematics are still plugins regardless. Net work is *higher*, not lower.

**Roll-your-own with FastAccelStepper + custom planner?** FastAccelStepper handles S3 RMT/MCPWM beautifully - 200 kHz, proper accel ramps - but has *no coordinated multi-axis planner*: each stepper ramps independently. To make four motors finish a segment at the same instant you'd write your own Bresenham layer, a Grbl-style look-ahead with junction deviation, G-code parser, state machine, settings, HTTP/WebSocket bridge. You're rebuilding 80% of FluidNC. ~3-6 person-months; FluidNC + a TwoCoreXY plugin is ~1-2 person-weeks.

**Verdict.** Take FluidNC whole, fork it, add `TwoCoreXY`. If something is genuinely unworkable, fall back to grblHAL (still whole). Bare ESP-IDF + FastAccelStepper only as a last resort.

---

## 7. Q3. Can our web GUI live on top of FluidNC?

**Yes, in two complementary ways.**

**Protocol surface (FluidNC v4):**

| Endpoint | Purpose |
|---|---|
| `GET /` | Serves `index.html` / `index.html.gz` from LittleFS (replaceable). |
| `POST /command?cmd=...` | One-shot G-code or `$`-command; returns text. |
| `POST /files` (multipart) | Upload to LittleFS. |
| `POST /upload` (multipart) | Upload to SD. |
| `GET /sd/<path>`, `/flash/<path>` | Raw files (also WebDAV in v4). |
| WebSocket on **port 81** (or 80 in v4.0.0/4.0.1) | Serial bridge. Send newline-terminated G-code, receive `ok`/`error`/`<...>` status. Realtime chars `? ~ ! 0x18` pass byte-for-byte. |

The WebSocket is our streaming primitive: line-by-line, respect Grbl's character-counted flow control (planner buffer ~16-32 blocks, RX buffer ~127 chars), poll `?` at 5-10 Hz, parse `<Run|MPos:X,Y,Z,A|FS:F,S|Bf:Pb,Rb|...>` to drive the Three.js view.

**CORS caveat.** FluidNC's HTTP server does not set `Access-Control-Allow-Origin` by default. WebSockets are not browser-bound by CORS for the connection itself, so a SPA at `https://our-site/` can open `ws://fluidnc.local:81/` fine. But cross-origin HTTP `fetch` (file upload, config) fails preflight unless we add CORS headers. Two options: (a) host SPA on-device (no CORS issue), (b) patch FluidNC's `WebServer` to add CORS headers (small `AsyncWebServer` change).

**Option A - bundle our SPA on FluidNC's LittleFS.** Build the Vite/Three.js app into one `dist/index.html` (inline JS+CSS), gzip to `index.html.gz` (<1 MB; lazy-load heavy code from SD), upload via `POST /files`. Same-origin: HTTP, WebSocket, file API all at `fluidnc.local`. No CORS. SPA reads/writes user data via `/files`, stores cut files via `/upload` to SD, streams G-code via WS. Replaces ESP3D-WEBUI; revert with `install-fs`.

**Option B - SPA on a separate origin.** Host on GitHub Pages / our server, connect over WS to `ws://fluidnc.local:81/`. Pros: faster iteration. Cons: dual network reachability, plus CORS patch needed for any HTTP fetches. Hybrid that works today: stream G-code over WS from hosted SPA, do uploads/config via WS `$`-commands rather than HTTP.

**grblHAL equivalent.** Identical surface: HTTP/80 + WS/81 via `Plugin_WebUI`, FS on FlashFS or SD `www/`. SPA replacement works the same; CORS situation same.

**Verdict.** Ship our SPA as `index.html.gz` on FluidNC's LittleFS (Option A). Same-origin everything, device self-contained on workshop wifi or SoftAP, SPA owns the UX. Fall back to Option B only for fast dev iteration.

---

## 8. Concrete next steps

1. Build FluidNC v4 main for `BOARD_GENERIC_S3` (Jackpot is a known-good reference). Confirm USB-CDC, WebSocket, LittleFS on a bare board.
2. Add `FluidNC/src/Kinematics/TwoCoreXY.{h,cpp}`, inheriting from `Cartesian`. Override `cartesian_to_motors` to apply the CoreXY mix to `(X,Y)` for gantry 1 and `(A,B)` for gantry 2; mirror in `motors_to_cartesian`. Register via `KinematicsFactory`.
3. YAML: 4 motors (X, Y, A, B) with steps/mm, accel, end stops; a `PWMSpindle` for the wire with calibrated `speed_map`.
4. Emit G-code from the CAM as `G1 X<x1> Y<y1> A<x2> B<y2> F<f> S<heat>` per sample. FluidNC's look-ahead planner buffers ~16-32 blocks; Bresenham guarantees per-block synchrony across all four motors.
5. Build the SPA into a single gzipped HTML, upload via `POST /files`, open the device URL. SPA opens the WebSocket, streams G-code with character-counted flow control, polls `?` for `<...|MPos:...>`, renders in Three.js.

---

## Sources

**FluidNC** - https://github.com/bdring/FluidNC (release notes; `src/Kinematics/{Kinematics.h, Cartesian.cpp, CoreXY.{h,cpp}}`, `src/Planner.cpp`, `src/Stepper.cpp`, `src/Stepping.{h,cpp}`, `src/Machine/Axes.h`, `src/Spindles/PWMSpindle.cpp`, `src/Configuration/GenericFactory.h`); wiki http://wiki.fluidnc.com (Kinematics, Axes, Spindles, WebUI, WebAPI, websockets, http-rest-api, ESP32-S3 Pin Reference, Local File System, Installation); DeepWiki https://deepwiki.com/bdring/FluidNC and https://deepwiki.com/bdring/FluidNC/5.1-axes-and-homing; issues #138, #218, #674, #1012, #1199.

**grblHAL** - https://github.com/grblHAL/core (`config.h`, `kinematics.h`, `kinematics/corexy.c`, `nuts_bolts.h`, `planner.c`, `stepper.c`); driver https://github.com/grblHAL/ESP32 (`main/CMakeLists.txt`, `main/my_machine.h`, README; discussion #107); plugin https://github.com/grblHAL/Plugin_WebUI; https://github.com/grblHAL/Templates; https://github.com/grblHAL/plugins; core discussion #672 (`N_AXIS = 8`); ESP32 issues #18, #155.

**Predecessors** - https://github.com/bdring/Grbl_Esp32 (deprecation notice; `Custom/CoreXY.cpp`); https://github.com/fra589/grbl-Mega-5X (issue #6).

**Web UI** - ESP3D-WEBUI https://github.com/luc-github/ESP3D-WEBUI; FluidNC fork https://github.com/michmela44/ESP3D-WEBUI/tree/3.0-FluidNCDev; FluidNC-Pendant https://github.com/AC8L/FluidNC-Pendant; FluidNC_GUI https://github.com/eghasemy/FluidNC_GUI; V1E forums https://forum.v1e.com/t/esp32-s3/50980 , https://forum.v1e.com/t/custom-ui-for-fluidnc/47558 , https://forum.v1e.com/t/webui-3-release-3-0-0-4b1-fluidnc/47841 .

**Other firmwares** - Marlin https://marlinfw.org/docs/configuration/configuration.html ; rcKeith Marlin fork https://github.com/rcKeith/Marlin ; Marlin2ForPipetBot https://derandere.gitlab.io/Marlin2ForPipetBot ; Klipper https://klipper.discourse.group/t/why-is-klipper-not-compatible-with-esp32/12231 ; klipper_esp32 https://github.com/nikhil-robinson/klipper_esp32 ; g2core https://github.com/synthetos/g2 ; Smoothie NuttX https://github.com/Smoothieware/smoothie-nuttx ; MotorGo https://github.com/Every-Flavor-Robotics/motorgo-arduino .

**Step generation** - FastAccelStepper https://github.com/gin66/FastAccelStepper ; ESP32 implementation https://deepwiki.com/gin66/FastAccelStepper/3.2-esp32-implementation ; MCPWM/PCNT https://deepwiki.com/gin66/FastAccelStepper/3.2.2-esp32-mcpwm-and-pulse-counter ; PR #162 (S3 MCPWM).

**Foam-cutter precedents** - Hackaday FluidNC 4-axis foam cutter https://hackaday.io/project/199287-fluidnc-4-axis-foam-cutter-controller ; MM2001 retrofit https://hackaday.io/project/195494-mm2001-foam-cutter-retrofit-fluidnc-ready ; rcKeith Grbl HotWire https://rckeith.co.uk/grbl-hotwire-mega-5x-for-cnc-foam-cutters/ ; LinuxCNC foam https://rckeith.co.uk/linuxcnc-4-axis-foam-cutting/ ; ThomasHeb/4AxisFoamCutter https://github.com/ThomasHeb/4AxisFoamCutter ; skwee/grbl-xyuv https://github.com/skwee/grbl-xyuv .

**ESP32-S3 docs** - USB-OTG console https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-guides/usb-otg-console.html ; MCPWM https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/mcpwm.html .
