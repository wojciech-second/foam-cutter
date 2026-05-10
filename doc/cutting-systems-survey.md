# Foam Cutting Systems: Deep Survey Beyond the Hobbyist Mainstream

Scope: research notes complementing the initial survey (GMFC, DevFoam, FoamWorks, JediCut, pywing, Foamcut, rahulsarchive/4AxisFoamCutter, ThomasHeb/4AxisFoamCutter, FluidNC, Grbl-Mega-5X). Emphasis on academic, industrial, and lesser-known work. **[Direct]** = relevant to a 4-axis ESP32-S3 CoreXY cutter for RC airfoils. **[Context]** = wider design space.

---

## 1. Mechanical architectures beyond the standard 4-axis pair

### 1.1 RoboCut — robot-controlled flexible rod cutting [Context]
The most important academic departure from the tower-pair model. Duenser, Poranne, Thomaszewski, and Coros (ETH Zurich / Haifa / Montreal) use two 7-DOF Franka Emika Panda arms to actively bend a heated, *flexible* rod (not a taut wire) while cutting EPS, escaping the piecewise-ruled-surface restriction. Core contribution: trajectory optimisation that simultaneously plans the elastic rod shape (Cosserat / Kirchhoff model under thermal softening), the two end-effector trajectories within robot kinematic limits, and a target-shape voxel error. Demonstrated by carving a sitting rabbit in roughly 10 cuts.
- ACM TOG 39(4), Article 98, 2020. DOI 10.1145/3386569.3392465. Preprint: https://crl.ethz.ch/papers/hotwirecutter.pdf
- ETH news: https://ethz.ch/en/news-and-events/eth-news/news/2020/09/a-robot-that-controls-highly-flexible-tools.html

### 1.2 Spatial Wire Cutting (SWC) — Gramazio Kohler [Context]
Two coordinated 6-axis robots hold a heated wire whose mid-span deflection is *embraced* — the bow under foam resistance becomes part of the toolpath, enabling doubly curved non-ruled surfaces. Pre-dates RoboCut and uses a taut wire instead of a full elastica.
- Project: http://gramaziokohler.arch.ethz.ch/web/e/forschung/272.html
- "Force Adaptive Hot-Wire Cutting" (Rust, Gramazio, Kohler, 2016): https://www.researchgate.net/publication/308413739
- CAADRIA 2016: https://papers.cumincad.org/cgi-bin/works/paper/caadria2016_529

### 1.3 Robotic Hot-Blade Cutting — BladeRunner / Odico / DTU [Context]
An 18-axis tri-robot system: two ABB arms elastically bend a heated *flat blade*; a third moves a foam block through it. Reported throughput: 2–3 min/m² of double-curved formwork vs. ~4 h/m² for conventional 5-axis CNC. Used to produce Olafur Eliasson's Fjordenhus formwork.
- RobArch 2014 chapter: https://link.springer.com/chapter/10.1007/978-3-319-26378-6_11
- Numerical simulation, IJAMT 2017, DOI 10.1007/s00170-017-0807-y
- DTU Orbit: https://orbit.dtu.dk/en/publications/robotic-hot-blade-cutting-an-industrial-approach-to-cost-effectiv

### 1.4 Robotic Abrasive Wire Cutting [Context]
Søndergaard et al., *Construction Robotics* 2018. Hot wire replaced by a high-speed *abrasive* wire on a carbon-fibre frame mounted to an ABB IRB 6700. Demonstrated on a 21 m UHPC structure (~70 % concrete saved). Reminds us that "wire-through-foam" can be mechanical, useful for foams that melt poorly (PIR, PUR).
- https://link.springer.com/article/10.1007/s41693-018-0016-8
- https://www.archdaily.com/905939/

### 1.5 Variable Lamination Manufacturing (VLM) — KAIST [Context]
Ahn, Lee, Yang et al. A 4-axis hot-wire cutter slices thick (≤4 mm) sloped EPS sheets that are then stacked. A **parallelogram mechanism** keeps the wire parallel while tilting — a non-tower-pair kinematic that still produces ruled-surface tilt. Same group performed thorough wire thermal characterisation.
- Toolpath gen, IJAMT 2005: https://link.springer.com/article/10.1007/s00170-005-0096-8
- Thermal characteristics, JMPT 2002: https://www.sciencedirect.com/science/article/abs/pii/S0890695501001444

### 1.6 Five-axis commercial CNC [Context]
Most commercial "5-axis" is **2+2+1** — two XY stages plus a rotary table that spins the block. Frog3D's FrogWire is canonical (https://www.frog3d.com/equipment/frogwire/). True 5-axis end-effector tilt is left to robot arms. Hobbyist examples: Victor Leung (TinyG2, http://www.victorleung.info/post/5-axis-hotwire-cutter/) and OpenBuilds (https://builds.openbuilds.com/threads/diy-5-axis-hot-wire-cutter-rotary.20680/).

### 1.7 Moving-foam vs. moving-wire [Context]
Industrial "downcutter"/contour machines (Xycorp, Hotwire Direct 8600, MegaPlot Twister) often hold a wire grid stationary and convey foam through it. WireDroid auto-configures the wire layout in <2 min. RC-scale work uses moving-wire universally.
- Xycorp WireDroid: https://www.xycorpinc.com/automatic-wire-setters/
- Hotwire Direct 8600: https://hotwiredirect.com/product/8600-cnc-contour-cutter/

### 1.8 Active wire tensioning and bow compensation [Direct]
Two practical patterns to borrow:
- **Pneumatic tensioning** for wires >3 m (HotWireSystems): ~3× higher and more constant tension than springs, allowing higher feed rates. Gravity tensioning is unbeatable for short (<1 m) wires due to its constant-force behaviour. https://hotwiresystems.com/hot-wire-cnc-foam-cutters-accessories-pneumatic-tension/
- **Closed-loop tension feedback** (Karmakar, Sathyan, Subbiah, IIT Madras): a load cell on the wire mount measures real-time tension; the controller modulates wire current so mechanical drag stays near zero, eliminating bow without explicit geometric modelling.
  - "Direct Wire-Tension Measurement Based Bowing Correction," Procedia Manuf. 2020: https://www.sciencedirect.com/science/article/pii/S2351978920314931
  - "Investigating Bowing of Hot Wire during cutting of EPS," Procedia Manuf. 2018: https://www.sciencedirect.com/science/article/pii/S2351978918307492

### 1.9 CoreXY foam cutters [Direct]
Few exist. The freedom2000 FluidNC project drives **4 independent steppers** (effectively two CoreXY-style gantries) on an ESP32 with a $20 PCBWay shield, running FluidNC; 1 m × 0.3 mm nichrome under PWM at <40 V from the same supply as the steppers. Closest precedent to our stack.
- Hackaday.io: https://hackaday.io/project/199287-fluidnc-4-axis-foam-cutter-controller
- MM2001 retrofit (same author): https://hackaday.io/project/195494
- PCBWay project: https://www.pcbway.com/project/shareproject/FluidNC_foam_cutter_controller_bad9d318.html
- grbl-Mega-5X CoreXY 4-axis issue: https://github.com/fra589/grbl-Mega-5X/issues/121
- JMG1/NiCr (older open-source CNC hot-wire cutter): https://github.com/JMG1/NiCr

### 1.10 Pantograph systems [Context]
The mechanical template-and-wire pantograph is the historical predecessor and still common in clubs. Philosophical opposite of CoreXY: the wire is constrained to a template; a person is the controller.

---

## 2. Patents and industrial tech notes

The patent landscape is sparse — most innovation is unpatented or held as trade secrets by small commercial vendors. Notable items:
- **US7411162B2** (Lincoln Electric, 2008) "Hot wire control apparatus and method." About welding, not foam, but it is the canonical "modulate wire current to maintain temperature given dynamic feed-force" patent. Architecturally directly applicable. https://patents.google.com/patent/US7411162
- **US20020117489A1** "Method and system for hot wire welding." Same Lincoln family; describes a separate DC secondary supply for wire current with the main process power decoupled — exactly the architecture better foam controllers use. https://patents.google.com/patent/US20020117489A1/en
- Commercial vendors (Hot Wire Foam Factory, Demand Products/Machinery, MegaPlot, Hotwire Direct, Foamlinx, Frog3D, CROMA, ProCut CNC, Xycorp, Streifeneder) differentiate primarily through software (e.g., MegaPlot's IX shaper) and ease-of-use packaging (auto wire setters, multi-wire grids, conveyors).
  - https://www.demandmachinery.com/ — https://hotwiredirect.com/ — https://www.megaplot.com/cnc-foam-cutting-machines/ — https://www.croma-foamcutter.com/

---

## 3. Academic literature

### 3.1 Kerf width modelling [Direct]
Three foundational papers:
- **Brooks & Aitchison (2010)** "Force feedback temperature control for hot-tool plastic foam cutting." *Proc. IMechE Part B* 224(10). DOI 10.1243/09544054JEM1717. Modulating wire power for constant *temperature* (not current) gives consistent kerf and finish independent of feed. Presents wire-temperature/feed-force curves for XPS. https://journals.sagepub.com/doi/10.1243/09544054JEM1717
- **Brooks & Aitchison (2014)** "Optimal machining conditions for polystyrene foam cut with a taut hot-wire." Nonlinear transient thermal FE model relates wire temperature, power, feed, kerf, and density for both EPS and XPS. https://www.researchgate.net/publication/268418942
- **Petrovic et al. (2020)** "A comprehensive numerical model for kerf width prediction in hot wire cutting of expanded polystyrene." *J. Manuf. Process.* 60, DOI 10.1016/j.jmapro.2020.10.029. 3-D thermal model including conductive/convective/radiative heat transfer, latent heat of melt + ablation, T-dependent properties, and wire-EPS thermal coupling, validated against experiment. https://www.sciencedirect.com/science/article/abs/pii/S1526612520305661

Useful additions: Aitchison & Brooks (2008) FE temperature distribution (https://clok.uclan.ac.uk/3874/); Hamade & Lakkis (2017) thermo-electro-mechanical sim (https://www.sciencedirect.com/science/article/abs/pii/S0890695516300475); Ahn et al. (2002) VLM thermal characterisation.

Quantitative take-aways:
- Kerf decreases with feed rate up to a critical wire temperature (~240 °C / 464 °F), above which kerf re-widens regardless of feed.
- For ~16 kg/m³ EPS, typical kerf compensation is **0.8–1.5 mm**; for ~30–35 kg/m³ XPS, **0.5–1.0 mm** (artisanfoam.com, epsole.com).
- Bow onset is a current-vs-feed tradeoff; insufficient current → mechanical drag → bow. IIT Madras shows that direct tension feedback can trim current to keep drag near zero.

### 3.2 Surface roughness and process windows
Brooks/Aitchison and the Karmakar 2018/2020 work report Ra changes with current and feed; clean-cut windows are narrow and density-dependent. IJERT 2015 also covers nichrome heating profile effects (https://www.ijert.org/research/influence-on-kerf-width-in-machining-polystyrene-by-heating-element-profile-maker-using-nichrome-wire-IJERTV4IS040275.pdf).

### 3.3 Path planning for non-developable / ruled surfaces
- **Steenstrup, K. H. (2016)** PhD thesis "Rationalization with ruled surfaces in architecture," DTU Compute PHD-2016-413. Shows how to segment a target shape into piecewise ruled blocks; up to 95 % material removed in pre-cutting steps. https://orbit.dtu.dk/files/126405810/phd413_Steenstrup_KH_reduced.pdf
- **Flöry & Pottmann (2010)** "Ruled Surfaces for Rationalization and Design in Architecture," ACADIA 2010 — the geometry/optimisation theory. https://papers.cumincad.org/data/works/att/acadia10_103.content.pdf

### 3.4 Robotics + hot wire for architectural / sculptural work
Beyond ETH and DTU/Odico: UCL Bartlett's **ProtoRobotic FOAMing** (https://www.ucl.ac.uk/bartlett/architecture/research/protorobotic-foaming) and IAAC PiCutter (https://www.iaacblog.com/programs/picutter/). KUKA|prc by Brell-Cokcan and Braumann is the dominant CAD-integrated robot toolchain (http://robotsinarchitecture.blogspot.com/p/about-us_05.html).

---

## 4. Materials [Direct]

Practical hierarchy for hot-wire RC airfoil work:

| Foam | Density (RC) | Hot-wire? | Notes |
|---|---|---|---|
| **EPS** (white beadboard) | 1.0–2.0 lb/ft³ (~16–32 kg/m³) | Excellent | Cheap, fast, slight bead texture. **1.5 lb/ft³ is the RC sweet spot.** |
| **XPS** (Foamular pink, Dow blue) | ~1.8 lb/ft³ (~28–35 kg/m³); 15–25 PSI | Excellent | Smoother surface, slower cut, glassy finish good for film covering. |
| **EPP** | ~1.3 lb/ft³, also 1.9 lb/ft³ | **No** (modern consensus) | PP melts and smears. Older sources said yes; current RC consensus says serrated knife or band saw. |
| **EPO** | ~1.5 lb/ft³ | Marginal | Same melt-vs-vaporise issue as EPP for some grades. |
| **PIR / Polyiso** (foil-faced) | ~32 kg/m³ | Marginal | Thermoset — chars rather than melts; dust + odor. Routing/knife preferred. |
| **PUR / PU** (surfboard blanks) | 4–6 lb/ft³ | Poor | Thermoset, chars. Industry uses planers / CNC routers (APS3000, Marko). |
| **Depron** | thin sheet | Excellent (but usually scored) | Common for fuselages; thin enough that knives work. |

References: rcplanediy.com 2026 (https://rcplanediy.com/2026/02/22/best-foam-rc-airplane-building/); Vortex-RC EPP datasheet (https://www.vortex-rc.com/2017/11/23/epp-expanded-poly-propylene-foam/); Marko density chart (https://markofoamblanks.com/pages/densitychart); GSD FabLab SOP (https://fablab.gsd.harvard.edu/health-and-safety/standard-operating-procedure-sop/hot-wire-foam-cutting-eps-and-xps/); Owens Corning Foamular (https://www.owenscorning.com/en-us/insulation/commercial/foamular-xps).

Density-driven cutting parameters: higher density → higher current OR slower feed. Standard wire is 0.3–0.5 mm Ni80/Ni60 for ~600–1200 mm spans (stainless / titanium alloys are used for very long industrial wires due to lower thermal stretch). For 1 m of 0.3 mm Ni80, operating power is typically 30–80 W — matches the freedom2000 setup at <40 V PWM.

---

## 5. Alternative cutting methods (comparison) [Context]

| Method | When it beats hot wire |
|---|---|
| **CNC routing** | Internal pockets, undercuts, dense foams (PU surfboard blanks, PIR, RenShape tooling). 5–10× slower on bulk. |
| **CO2 laser** | Fine 2-D detail in thin sheets. Caution: EPS/XPS are flammable and don't self-extinguish; PVC foam releases HCl and destroys optics. Mandatory fume extraction. Almost always worse than hot wire for thick blocks. |
| **Abrasive waterjet** | Foams that don't cut thermally (PIR, PU). Cold, no fumes. Slow, expensive, garnet capture. Not used in RC. |
| **Oscillating knife** (Zünd, Esko) | Soft foams (PU upholstery, EPP, sound foam) up to ~50–100 mm. Very precise, no dust, no melt. |
| **Ultrasonic blade** | 1–30 mm soft/medium foam. Clean edges. Industrial, expensive. |
| **Hot wire** | EPS/XPS bulk shaping, ruled surfaces, blocks ≥30 mm. Fast, cheap, low operator skill. |

References: AccTek oscillating knife (https://www.acctekgroup.com/oscillating-knife-cutting-machine/foam-oscillating-knife-cutting-machines/); Truster ultrasonic vs mechanical (https://www.trustercnc.com/ultrasonic-vs-mechanical-cnc-oscillating-knife-cutter/); Foamlinx selection guide (https://www.foamlinx.com/post/which-machine-to-use-when-cutting-foam-and-what-type-of-foam-to-cut); Frog3D routing guide (https://www.frog3d.com/guide-to-cutting-foam-with-a-cnc-router/); xTool laser foam (https://www.xtool.com/blogs/xtool-academy/laser-cut-foam); FSL "do not laser" (https://fslaser.com/blog/do-not-cut-this-with-a-co2-laser/).

---

## 6. Lesser-known open-source / community projects [Direct]

Beyond the names already listed:
- **freedom2000 / FluidNC 4-axis controller** (2024): ESP32 + 4× DRV8825 on a $20 PCB; PWM nichrome up to 40 V. Closest ESP32 precedent. https://hackaday.io/project/199287-fluidnc-4-axis-foam-cutter-controller and https://www.printables.com/model/1104992
- **JMG1 / NiCr** — open hardware low-cost CNC hot-wire cutter: https://github.com/JMG1/NiCr
- **mschafer / foamcut** — older C++/Qt CAM: https://github.com/mschafer/foamcut
- **proto3 / pywing** — PyQt5 G-code generator/sender talking 4-axis (XYUV) Grbl: https://github.com/proto3/pywing
- **reederward1285 / 4AxisFoamCutter** — independent 4-axis G-code gen + interpreter: https://github.com/reederward1285/4AxisFoamCutter
- **DevCAD DevCnc Foam / DevSim Cnc Foam** — closed but free; DevSim simulates 4- or 5-axis (with rotary). https://www.devcad.com/eng/devsimcncfoam.asp
- **WingHelper, WingDesigner 4 Hotwire, Gemini Aero Cutter** — newer paid/free RC tools (https://rckeith.co.uk/foam-wing-free-cnc-software/).
- ESP32 firmware ecosystem: **bdring/FluidNC** (https://github.com/bdring/FluidNC) and predecessor **bdring/Grbl_Esp32**. No active **RP2040**-based foam cutter found in 2024–2025; rckeith.co.uk has used SKR Pico + grblHAL for foam. CoreXY remains rare in foam — most of the field is rectilinear.

---

## 7. What we should consider for this project

### 7.1 Ideas worth borrowing

1. **Closed-loop wire control beats open-loop PWM.** Brooks & Aitchison's force-feedback temperature control and the IIT Madras direct-tension feedback both kill the morning-vs-afternoon kerf drift that plagues open-loop machines. Cheapest practical instrumentation on the ESP32-S3: measure **wire resistance** (V/I across a sense resistor). Resistance is monotonic in temperature for nichrome and trivial to read on the S3 ADC — no thermocouple-on-wire build required. Add a load cell on the wire mount for real-time tension if budget allows.

2. **Treat kerf as f(current, feed, density), not a constant.** All academic kerf modelling agrees. CAM should ask for a foam-density tag and pick kerf compensation from a calibrated lookup. With instrumented wire, calibrate live.

3. **Wire bow as a known unknown.** Even with closed-loop current, residual bow is the dominant geometric error on long wires. Two responses: (a) software bow-compensation pre-distorting the path so the bowed wire ends where intended (Karmakar 2018 gives the parameter dependence — equilibrium bow ≈ drag/tension); (b) mechanically: gravity tension for ≤1 m wires, pneumatic/spring-with-pulley beyond.

4. **Stick to ruled surfaces in CAM.** Theoretically a hobbyist 4-axis lets you move both ends independently to chase non-ruled output, but the wire chord ≠ surface chord and the result is usually wrong. RoboCut shows what a proper non-ruled solver costs (full elastica + dual end-effector poses + optimisation) — out of scope for v1. The CAM should explicitly **constrain output to ruled surfaces** and warn if root/tip airfoil sweep produces a non-developable loft.

5. **Pair root and tip stations by chord-fraction or arc-length** (already on our list) — and document the choice. Arc-length is correct for symmetric tapers; chord-fraction is the hobbyist default and is fine for tapers <2:1.

6. **Borrow the freedom2000 power architecture.** Single 24–40 V DC supply for steppers + PWM nichrome via logic-level MOSFET, with current sensing through a small shunt. Proven on the ESP32 stack.

7. **Use FluidNC patterns even if writing custom firmware.** YAML config, WebSocket UI, fluid axis remapping. ESP32-S3 makes this easy and matches maker-world expectations.

8. **Keep "moving foam" as a future mode.** For long wing cores, a moving-block stage with a fixed wire is mechanically simpler than a long gantry. Not v1, but worth designing the kinematics layer to allow it.

9. **CoreXY is unconventional for foam — be sure we want it.** Most of the field is rectilinear because gantries are short. CoreXY's advantages (low moving mass, high acceleration, rigid frame) matter at 3D-printer speeds; at <50 mm/s feed, the benefit is marginal. The cost is a more complex motion model and the need to carefully synchronise *two* CoreXY systems across the wire. The simulator must handle this from day one.

### 7.2 Pitfalls to avoid

- **Don't trust any single kerf number.** Wire temperature drifts with ambient; EPS density varies between vendors. Build kerf calibration into the user workflow, not into firmware constants.
- **Don't try to cut EPP, PUR, or PIR with hot wire.** PP melts and re-fuses, leaving slag that changes wire diameter and kerf. Thermoset foams char.
- **Don't run the wire too hot.** Above ~250 °C wire temperature, EPS vaporises faster than it melts; kerf widens unpredictably and surface gets glassy/pitted. Cooler wire + slower feed = accuracy.
- **Don't ignore wire elongation.** Nichrome stretches ~1 % over its operating range — a 1 m wire grows ~10 mm hot vs cold. Fixed-end wires sag. Plan tensioner travel.
- **Don't trust gantry alignment.** The two CoreXY systems must be parallel to ~0.1 mm over the whole travel; a 0.5 mm twist becomes a measurable airfoil incidence error.
- **Don't simulate only the ideal straight wire.** Provide a debug visualisation of the *bowed* wire under estimated drag (Karmakar/Brooks model). It's the gap between "looks right in sim" and "is right on the foam."
- **Watch for fume buildup.** EPS hot-wire produces styrene and small amounts of volatile aromatics (CO2 laser of EPS is much worse). Plan ventilation in v1.

### 7.3 References to revisit when building each subsystem

- **Wire-power controller**: Brooks & Aitchison 2010; Lincoln US7411162B2.
- **Bow / tension feedback**: Karmakar & Sathyan 2018; Karmakar 2020 (IIT Madras); Brooks & Aitchison 2014 thermal-mechanical balance.
- **Kerf prediction in CAM**: Petrovic et al. 2020; Aitchison & Brooks 2008 FE; Brooks & Aitchison 2014.
- **Path planning / ruled-surface rationalisation**: Steenstrup PhD 2016; Flöry & Pottmann 2010.
- **Stretch goal — non-ruled cutting**: RoboCut SIGGRAPH 2020 (reading list, not v1).
- **ESP32 firmware**: bdring/FluidNC; freedom2000 Hackaday.io for wiring and PWM scheme.
- **Industrial reference behaviour**: Frog3D FrogWire (5-axis); MegaPlot Twister (multi-wire); Marko APS3000 (CNC for dense PU, contrast).

---
*End of survey.*
