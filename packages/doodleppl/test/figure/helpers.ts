import type { GraphElement, UnifiedModelData } from "../../src/core/types";

/** Twelve hospitals sharing a population: a plate, a hierarchy, and every node kind. */
export function hospitals(): UnifiedModelData {
  const elements: GraphElement[] = [
    {
      id: "plate_i",
      name: "Plate.i",
      type: "node",
      nodeType: "plate",
      loopVariable: "i",
      loopRange: "1:N",
      position: { x: 190, y: 330 },
    },
    {
      id: "mu",
      name: "mu",
      type: "node",
      nodeType: "stochastic",
      distribution: "dnorm",
      position: { x: 60, y: 40 },
    },
    {
      id: "tau",
      name: "tau",
      type: "node",
      nodeType: "stochastic",
      distribution: "dgamma",
      position: { x: 200, y: 40 },
    },
    {
      id: "b",
      name: "b",
      type: "node",
      nodeType: "stochastic",
      parent: "plate_i",
      indices: "i",
      distribution: "dnorm",
      position: { x: 124, y: 150 },
    },
    {
      id: "p",
      name: "p",
      type: "node",
      nodeType: "deterministic",
      parent: "plate_i",
      indices: "i",
      equation: "logistic(b[i])",
      position: { x: 124, y: 250 },
    },
    {
      id: "n",
      name: "n",
      type: "node",
      nodeType: "constant",
      parent: "plate_i",
      indices: "i",
      position: { x: 256, y: 250 },
    },
    {
      id: "r",
      name: "r",
      type: "node",
      nodeType: "observed",
      parent: "plate_i",
      indices: "i",
      distribution: "dbin",
      position: { x: 190, y: 380 },
    },
    { id: "e1", type: "edge", source: "mu", target: "b" },
    { id: "e2", type: "edge", source: "tau", target: "b" },
    { id: "e3", type: "edge", source: "b", target: "p" },
    { id: "e4", type: "edge", source: "p", target: "r" },
    { id: "e5", type: "edge", source: "n", target: "r" },
  ];
  return { name: "Surgical", elements };
}

/** Two nested plates, with a node named like a TikZ anchor. */
export function nested(): GraphElement[] {
  return [
    {
      id: "plate_i",
      name: "Plate.i",
      type: "node",
      nodeType: "plate",
      loopVariable: "i",
      loopRange: "1:N",
    },
    {
      id: "plate_j",
      name: "Plate.j",
      type: "node",
      nodeType: "plate",
      loopVariable: "j",
      loopRange: "1:T",
      parent: "plate_i",
    },
    {
      id: "node_alpha.c",
      name: "alpha.c",
      type: "node",
      nodeType: "stochastic",
      position: { x: 0, y: 0 },
    },
    {
      id: "alpha",
      name: "alpha",
      type: "node",
      nodeType: "stochastic",
      parent: "plate_i",
      indices: "i",
      position: { x: 0, y: 120 },
    },
    {
      id: "y",
      name: "Y",
      type: "node",
      nodeType: "observed",
      parent: "plate_j",
      indices: "i,j",
      position: { x: 0, y: 240 },
    },
    { id: "e1", type: "edge", source: "node_alpha.c", target: "alpha" },
    { id: "e2", type: "edge", source: "alpha", target: "y" },
  ];
}
