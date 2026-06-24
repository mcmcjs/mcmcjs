---
"@mcmcjs/plots": minor
---

Add the energy diagnostic plot (HMC/NUTS). `energyData` builds the centered marginal-energy and energy-transition distributions on shared bins plus per-chain E-BFMI from the `hamiltonian_energy` sampler stat; `renderEnergyTerminal` and `renderEnergySVG` overlay the two curves and report the E-BFMI.
