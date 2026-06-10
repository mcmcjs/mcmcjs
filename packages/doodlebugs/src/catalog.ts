// The BUGS language surface DoodleBUGS models against: the distribution catalog
// (ported from the editor's nodeDefinitions) and the built-in function set. This
// is the single source of truth for editors, validators, and agents authoring
// graphs; UI concerns (icons, styles, property editors) stay with the editor.

export interface Distribution {
  /** The BUGS function name written into a node's `distribution` field. */
  name: string;
  label: string;
  paramCount: number;
  /** Positional meaning of param1..paramN. */
  paramNames: string[];
  helpText?: string;
}

export const DISTRIBUTIONS: Distribution[] = [
  {
    name: "dnorm",
    label: "Normal (dnorm)",
    paramCount: 2,
    paramNames: ["mean", "precision"],
    helpText:
      "Parameters: mean (expected value), precision (1/variance). Note: BUGS uses precision instead of standard deviation.",
  },
  {
    name: "dgamma",
    label: "Gamma (dgamma)",
    paramCount: 2,
    paramNames: ["shape", "rate"],
    helpText: "Parameters: shape (alpha), rate (1/beta).",
  },
  {
    name: "dbeta",
    label: "Beta (dbeta)",
    paramCount: 2,
    paramNames: ["shape1", "shape2"],
    helpText: "Parameters: shape1 (alpha), shape2 (beta).",
  },
  {
    name: "dbern",
    label: "Bernoulli (dbern)",
    paramCount: 1,
    paramNames: ["prob"],
    helpText: "Parameter: prob (probability of success).",
  },
  {
    name: "dbin",
    label: "Binomial (dbin)",
    paramCount: 2,
    paramNames: ["prob", "size"],
    helpText: "Parameters: prob (success probability), size (number of trials).",
  },
  {
    name: "dpois",
    label: "Poisson (dpois)",
    paramCount: 1,
    paramNames: ["lambda"],
    helpText: "Parameter: lambda (expected number of occurrences).",
  },
  {
    name: "dexp",
    label: "Exponential (dexp)",
    paramCount: 1,
    paramNames: ["rate"],
    helpText: "Parameter: rate (lambda).",
  },
  {
    name: "dt",
    label: "Student-t (dt)",
    paramCount: 3,
    paramNames: ["mu", "tau", "k"],
    helpText: "Parameters: mu (mean), tau (precision), k (degrees of freedom).",
  },
  {
    name: "dunif",
    label: "Uniform (dunif)",
    paramCount: 2,
    paramNames: ["lower", "upper"],
    helpText: "Parameters: lower (minimum value), upper (maximum value).",
  },
  {
    name: "dweib",
    label: "Weibull (dweib)",
    paramCount: 2,
    paramNames: ["shape", "lambda"],
    helpText: "Parameters: shape (v), lambda (rate). Mean = lambda^(-1/v) * Gamma(1 + 1/v).",
  },
  {
    name: "dlnorm",
    label: "Log-Normal (dlnorm)",
    paramCount: 2,
    paramNames: ["mu", "precision"],
    helpText: "Parameters: mu (mean of log), precision (1/variance of log).",
  },
  {
    name: "dcat",
    label: "Categorical (dcat)",
    paramCount: 1,
    paramNames: ["p"],
    helpText: "Parameter: p (vector of probabilities).",
  },
  {
    name: "ddexp",
    label: "Double Exponential (ddexp)",
    paramCount: 2,
    paramNames: ["mu", "tau"],
    helpText: "Parameters: mu (location), tau (precision). Also known as Laplace distribution.",
  },
  {
    name: "dchisqr",
    label: "Chi-Squared (dchisqr)",
    paramCount: 1,
    paramNames: ["k"],
    helpText: "Parameter: k (degrees of freedom).",
  },
  {
    name: "dpar",
    label: "Pareto (dpar)",
    paramCount: 2,
    paramNames: ["alpha", "c"],
    helpText: "Parameters: alpha (shape), c (scale/minimum).",
  },
  {
    name: "dnegbin",
    label: "Negative Binomial (dnegbin)",
    paramCount: 2,
    paramNames: ["p", "r"],
    helpText: "Parameters: p (probability), r (number of failures).",
  },
  {
    name: "dlogis",
    label: "Logistic (dlogis)",
    paramCount: 2,
    paramNames: ["mu", "tau"],
    helpText: "Parameters: mu (location), tau (precision).",
  },
  {
    name: "dmnorm",
    label: "Multivariate Normal (dmnorm)",
    paramCount: 2,
    paramNames: ["mu", "T"],
    helpText: "Parameters: mu (mean vector), T (precision matrix).",
  },
  {
    name: "dwish",
    label: "Wishart (dwish)",
    paramCount: 2,
    paramNames: ["R", "k"],
    helpText: "Parameters: R (scale matrix), k (degrees of freedom).",
  },
  {
    name: "ddirich",
    label: "Dirichlet (ddirich)",
    paramCount: 1,
    paramNames: ["alpha"],
    helpText: "Parameter: alpha (concentration vector).",
  },
  {
    name: "dmulti",
    label: "Multinomial (dmulti)",
    paramCount: 2,
    paramNames: ["p", "N"],
    helpText: "Parameters: p (probability vector), N (number of trials).",
  },
  {
    name: "dflat",
    label: "Flat (dflat)",
    paramCount: 0,
    paramNames: [],
    helpText: "Improper flat (uniform) prior on the real line.",
  },
  {
    name: "dhyper",
    label: "Hypergeometric (dhyper)",
    paramCount: 3,
    paramNames: ["n1", "n2", "n3"],
    helpText: "Parameters: n1 (white), n2 (total draws), n3 (total objects).",
  },
  {
    name: "dgev",
    label: "Generalized Extreme Value (dgev)",
    paramCount: 3,
    paramNames: ["mu", "sigma", "xi"],
    helpText: "Parameters: mu (location), sigma (scale), xi (shape).",
  },
  {
    name: "df",
    label: "F distribution (df)",
    paramCount: 2,
    paramNames: ["n", "m"],
    helpText: "Parameters: n (numerator df), m (denominator df).",
  },
  {
    name: "dgenpar",
    label: "Generalized Pareto (dgenpar)",
    paramCount: 3,
    paramNames: ["mu", "sigma", "xi"],
    helpText: "Parameters: mu (location), sigma (scale), xi (shape).",
  },
];

const byName = new Map(DISTRIBUTIONS.map((d) => [d.name, d]));

export function getDistribution(name: string): Distribution | undefined {
  return byName.get(name);
}

/** BUGS built-in functions usable in deterministic equations and data transforms. */
export const BUGS_FUNCTIONS: ReadonlySet<string> = new Set([
  "sqrt",
  "log",
  "exp",
  "sin",
  "cos",
  "tan",
  "abs",
  "round",
  "trunc",
  "step",
  "mean",
  "sum",
  "prod",
  "sd",
  "var",
  "min",
  "max",
  "inverse",
  "logdet",
  "logit",
  "ilogit",
  "logistic",
  "probit",
  "cloglog",
  "phi",
  "pow",
  "loggam",
  "logfact",
  "icloglog",
  "cexpexp",
  "inprod",
  "equals",
  "mexp",
  "softplus",
]);
