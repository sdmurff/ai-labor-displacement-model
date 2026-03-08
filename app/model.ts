/**
 * Task-Based Model of AI and Employment (v2)
 * Based on Acemoglu & Restrepo (2018, 2019, 2022)
 *
 * Calibrated to 22 SOC major groups using:
 * - Current automation: Anthropic Economic Index observed exposure (Massenkoff & McCrory, 2026)
 * - Theoretical ceiling: Eloundou et al. (2023) β scores (avg of GPT-4 + human raters)
 * - Employment: BLS OES May 2021
 * - Validation target: BLS Occupational Projections 2020-2030 (pre-AI baseline)
 *
 * Key improvement over v1: automation frontier is bounded by a theoretical ceiling
 * and adoption follows a logistic gap-closing dynamic, not a constant rate.
 *
 * dL/L = -displacement + reinstatement + demand_expansion
 *      = -(dI/(1-I)) + (dN/(1-I)) + ε * (dA/A)
 *
 * IMPORTANT: Observed exposure interpretation
 * -------------------------------------------
 * Massenkoff & McCrory's `observed` exposure (r̃_t) is an UPPER BOUND on true
 * automation (I₀ in the A&R framework). Their measure includes BOTH automation
 * AND augmentation usage, weighted by α_t which ranges from 0.5 (pure augmentation)
 * to 1.0 (pure automation):
 *
 *   r̃_t = 𝟙{WorkUsage ≥ 100} × 𝟙{β_t ≥ 0.5} × α_t
 *   α_t = 1/2 + 1/2 × [ClaudeWork × AutoShare + API] / [ClaudeWork + API]
 *
 * Using raw `observed` as I₀ overstates the automation frontier because augmented
 * tasks (human+AI collaboration) are still partially counted. The gap between
 * `observed` and true automation represents augmentation, which contributes to
 * `humanProductivityGrowth` rather than displacement. Users can adjust the
 * `currentAutomation` slider downward to model a lower true-automation share.
 */

/** Parameter provenance: where a value comes from */
export type ParamSource = "data" | "derived" | "assumed";

export interface TaskDistribution {
  /** fraction of tasks currently automated (from Anthropic observed data) */
  currentAutomation: number;
  /** theoretical ceiling — max automatable fraction (from Eloundou β) */
  theoreticalCeiling: number;
  /** annual adoption speed — fraction of remaining gap closed per year (0-1) */
  adoptionSpeed: number;
  /** annual ceiling expansion rate — how fast the ceiling itself grows */
  ceilingGrowthRate: number;
  /** annual rate of new task creation (as fraction of total tasks) */
  newTaskRate: number;
  /** productivity gain on remaining human tasks (annual multiplier) */
  humanProductivityGrowth: number;
  /** output demand elasticity */
  demandElasticity: number;
}

/**
 * Provenance metadata for each parameter.
 * - "data": directly from BLS/Massenkoff/Eloundou empirical sources
 * - "derived": calculated from data using a documented formula
 * - "assumed": heuristic with no direct empirical backing — adjust with slider
 */
export const PARAM_PROVENANCE: Record<keyof TaskDistribution, { source: ParamSource; citation: string }> = {
  currentAutomation: {
    source: "data",
    citation: "Massenkoff & McCrory (2026) observed exposure — upper bound on true automation (includes augmentation)",
  },
  theoreticalCeiling: {
    source: "data",
    citation: "Eloundou et al. (2023) β scores — avg of GPT-4 + human raters",
  },
  adoptionSpeed: {
    source: "derived",
    citation: "Heuristic: base rate by sector × (0.5 + adoption ratio). No direct empirical source.",
  },
  ceilingGrowthRate: {
    source: "assumed",
    citation: "Assumed: knowledge 2%/yr, service 1%/yr, manual 0.5%/yr. No empirical calibration.",
  },
  newTaskRate: {
    source: "derived",
    citation: "Heuristic: base rate by sector × max(β, 0.1). Inspired by A&R reinstatement concept.",
  },
  humanProductivityGrowth: {
    source: "derived",
    citation: "Heuristic: sector base rate × β. AI productivity gain proportional to exposure.",
  },
  demandElasticity: {
    source: "assumed",
    citation: "Assumed: sector base + β × 0.8. A&R (2019) implicitly ε≈1. Bessen (2019) range: 0.5–3+.",
  },
};

export interface SOCGroup {
  soc: string;
  name: string;
  /** BLS total employment */
  employment: number;
  /** Anthropic observed exposure — UPPER BOUND on automation, includes augmentation */
  observed: number;
  /** Eloundou α (direct LLM only) */
  alpha: number;
  /** Eloundou β (with partial tools) — used as default ceiling */
  beta: number;
  /** Eloundou γ (full tool exposure) */
  gamma: number;
  /** BLS projected employment change 2020-2030 (pre-AI baseline for validation) */
  blsProjectedGrowth: number;
  defaults: TaskDistribution;
}

export interface YearResult {
  year: number;
  automationFrontier: number;
  ceiling: number;
  totalTasks: number;
  humanTasks: number;
  humanTaskShare: number;
  productivityMultiplier: number;
  outputDemandMultiplier: number;
  employmentMultiplier: number;
  employmentPctChange: number;
  displacementEffect: number;
  reinstatementEffect: number;
  demandEffect: number;
}

export interface GroupResult {
  soc: string;
  name: string;
  baselineEmployment: number;
  timeline: YearResult[];
  finalPctChange: number;
  finalEmployment: number;
}

/**
 * Classify SOC groups by sector type for default parameter estimation.
 * Returns: 'knowledge' | 'service' | 'manual'
 */
function sectorType(soc: string): "knowledge" | "service" | "manual" {
  // Knowledge-intensive white collar
  if (["11", "13", "15", "17", "19", "23", "25", "27"].includes(soc)) return "knowledge";
  // Service-oriented
  if (["21", "29", "31", "33", "35", "39", "41", "43"].includes(soc)) return "service";
  // Manual / physical
  return "manual";
}

/**
 * Estimate reasonable default parameters for a SOC group based on its data profile.
 */
function estimateDefaults(soc: string, observed: number, beta: number): Omit<TaskDistribution, "currentAutomation" | "theoreticalCeiling"> {
  const type = sectorType(soc);
  const adoptionRatio = beta > 0 ? observed / beta : 0;

  // Adoption speed: faster for groups already showing high adoption
  // Base rate differs by sector; adjusted by current adoption momentum
  const baseAdoption = type === "knowledge" ? 0.12 : type === "service" ? 0.08 : 0.05;
  const adoptionSpeed = baseAdoption * (0.5 + adoptionRatio);

  // Ceiling growth: knowledge work ceilings expand as AI capabilities improve
  const ceilingGrowthRate = type === "knowledge" ? 0.02 : type === "service" ? 0.01 : 0.005;

  // New task creation: higher in knowledge work, scaled by exposure
  const baseNewTask = type === "knowledge" ? 0.03 : type === "service" ? 0.015 : 0.005;
  const newTaskRate = baseNewTask * Math.max(beta, 0.1); // scale by theoretical exposure

  // Productivity growth on human tasks — AI-driven productivity only applies
  // proportional to how much AI actually touches the occupation.
  // Base rate is the max sector rate; actual rate scales with theoretical ceiling (β).
  // For barely-exposed jobs (β ≈ 0.04), productivity boost is negligible.
  const baseProdGrowth = type === "knowledge" ? 0.10 : type === "service" ? 0.06 : 0.03;
  const humanProductivityGrowth = 1 + baseProdGrowth * beta;

  // Demand elasticity: scales with both sector type AND exposure level.
  // Higher exposure → more tasks become cheaper → more scope for demand expansion.
  // Knowledge work has a higher base because output is inherently more expandable
  // (there's always more analysis, more code, more research to do).
  // Service/admin: moderate base, but highly-exposed groups (Office & Admin β=0.56)
  // get higher elasticity than barely-exposed ones (Food & Serving β=0.15).
  //
  // Sources (empirical range):
  // - Acemoglu & Restrepo (2019) implicitly assume ε ≈ 1 in their baseline
  // - Bessen (2019) documents historical ε ranging from 0.5 (textiles) to 3+ (computing)
  // - No direct per-occupation empirical calibration exists — these are ASSUMED.
  //   Users should treat these as starting points and adjust with the slider.
  const baseElasticity = type === "knowledge" ? 1.4 : type === "service" ? 0.7 : 0.3;
  const demandElasticity = baseElasticity + beta * 0.8;

  return { adoptionSpeed, ceilingGrowthRate, newTaskRate, humanProductivityGrowth, demandElasticity };
}

// ─── Data: 22 SOC major groups ──────────────────────────────────────────────
//
// Sources & aggregation method:
// - employment: BLS OES May 2021 (national_May2021_dl.csv), summed to SOC 2-digit major groups
// - observed: Anthropic Economic Index (anthropic_job_exposure.csv), employment-weighted avg to major groups
//   NOTE: "observed" is an UPPER BOUND on automation — includes augmentation. See header comment.
// - alpha/beta/gamma: Eloundou et al. (2023) (occ_level.csv), employment-weighted avg of
//   (dv_rating_* + human_rating_*) / 2 to major groups
// - blsProjectedGrowth: BLS 2020-2030 projections (occupations_projections_processed.csv),
//   pre-AI baseline. Divergence from model is expected and informative.

type RawSOC = { soc: string; name: string; employment: number; observed: number; alpha: number; beta: number; gamma: number; blsProjectedGrowth: number };

const rawData: RawSOC[] = [
  { soc: "11", name: "Management", employment: 8909920, observed: 0.1304, alpha: 0.0983, beta: 0.4509, gamma: 0.8034, blsProjectedGrowth: 9.3 },
  { soc: "13", name: "Business & Finance", employment: 9053780, observed: 0.2844, alpha: 0.1729, beta: 0.5282, gamma: 0.8836, blsProjectedGrowth: 8.0 },
  { soc: "15", name: "Computer & Math", employment: 4654750, observed: 0.3577, alpha: 0.3677, beta: 0.6342, gamma: 0.9008, blsProjectedGrowth: 14.1 },
  { soc: "17", name: "Architecture & Engineering", employment: 2436520, observed: 0.0451, alpha: 0.1900, beta: 0.4887, gamma: 0.7873, blsProjectedGrowth: 5.6 },
  { soc: "19", name: "Life & Social Sciences", employment: 1273610, observed: 0.1045, alpha: 0.2007, beta: 0.4646, gamma: 0.7285, blsProjectedGrowth: 7.9 },
  { soc: "21", name: "Social Services", employment: 2239700, observed: 0.0401, alpha: 0.1678, beta: 0.3420, gamma: 0.5163, blsProjectedGrowth: 12.4 },
  { soc: "23", name: "Legal", employment: 1178140, observed: 0.2037, alpha: 0.0963, beta: 0.4634, gamma: 0.8304, blsProjectedGrowth: 8.8 },
  { soc: "25", name: "Education & Library", employment: 8191940, observed: 0.1819, alpha: 0.1413, beta: 0.3594, gamma: 0.5776, blsProjectedGrowth: 10.1 },
  { soc: "27", name: "Arts & Media", employment: 1815270, observed: 0.1916, alpha: 0.1989, beta: 0.4556, gamma: 0.7123, blsProjectedGrowth: 13.1 },
  { soc: "29", name: "Healthcare Practitioners", employment: 8787720, observed: 0.0547, alpha: 0.1111, beta: 0.3451, gamma: 0.5792, blsProjectedGrowth: 10.8 },
  { soc: "31", name: "Healthcare Support", employment: 6603660, observed: 0.0226, alpha: 0.0783, beta: 0.1666, gamma: 0.2549, blsProjectedGrowth: 23.1 },
  { soc: "33", name: "Protective Service", employment: 3385060, observed: 0.0288, alpha: 0.1520, beta: 0.2588, gamma: 0.3655, blsProjectedGrowth: 8.4 },
  { soc: "35", name: "Food & Serving", employment: 11201470, observed: 0.0087, alpha: 0.0903, beta: 0.1497, gamma: 0.2092, blsProjectedGrowth: 19.6 },
  { soc: "37", name: "Grounds Maintenance", employment: 4108810, observed: 0.0057, alpha: 0.0160, beta: 0.0419, gamma: 0.0678, blsProjectedGrowth: 7.5 },
  { soc: "39", name: "Personal Care", employment: 2566450, observed: 0.0210, alpha: 0.1377, beta: 0.2110, gamma: 0.2844, blsProjectedGrowth: 21.7 },
  { soc: "41", name: "Sales", employment: 13256290, observed: 0.2690, alpha: 0.2166, beta: 0.4251, gamma: 0.6337, blsProjectedGrowth: -1.4 },
  { soc: "43", name: "Office & Admin", employment: 18299370, observed: 0.3434, alpha: 0.3148, beta: 0.5620, gamma: 0.8092, blsProjectedGrowth: -2.8 },
  { soc: "45", name: "Agriculture", employment: 451850, observed: 0.0127, alpha: 0.0390, beta: 0.1089, gamma: 0.1789, blsProjectedGrowth: 2.5 },
  { soc: "47", name: "Construction", employment: 5848940, observed: 0.0111, alpha: 0.0251, beta: 0.1044, gamma: 0.1837, blsProjectedGrowth: 5.7 },
  { soc: "49", name: "Installation & Repair", employment: 5574400, observed: 0.0156, alpha: 0.0562, beta: 0.1363, gamma: 0.2165, blsProjectedGrowth: 6.7 },
  { soc: "51", name: "Production", employment: 8408020, observed: 0.0068, alpha: 0.0553, beta: 0.1305, gamma: 0.2057, blsProjectedGrowth: -0.4 },
  { soc: "53", name: "Transportation", employment: 12639900, observed: 0.0021, alpha: 0.0759, beta: 0.1532, gamma: 0.2305, blsProjectedGrowth: 8.8 },
];

export const socGroups: SOCGroup[] = rawData.map((d) => ({
  ...d,
  defaults: {
    currentAutomation: d.observed, // NOTE: upper bound — see header comment on observed exposure
    theoreticalCeiling: d.beta,
    ...estimateDefaults(d.soc, d.observed, d.beta),
  },
}));

/** Demand elasticity presets for scenario analysis */
export const DEMAND_ELASTICITY_PRESETS = {
  conservative: { label: "Conservative (ε=0.5)", value: 0.5, description: "Productivity gains mostly reduce employment. Historical parallel: agriculture." },
  baseline: { label: "Baseline (ε=1.0)", value: 1.0, description: "Demand and productivity grow equally. A&R (2019) implicit baseline." },
  moderate: { label: "Moderate (ε=1.5)", value: 1.5, description: "Moderate Jevons effect — demand growth outpaces productivity." },
  optimistic: { label: "Optimistic (ε=2.0)", value: 2.0, description: "Strong Jevons effect. Historical parallel: computing/software." },
} as const;

// ─── Simulation ─────────────────────────────────────────────────────────────

export function simulateGroup(
  group: SOCGroup,
  overrides: Partial<TaskDistribution>,
  years: number
): GroupResult {
  const p: TaskDistribution = { ...group.defaults, ...overrides };

  const timeline: YearResult[] = [];

  let ceiling = p.theoreticalCeiling;
  // Fix 4: Clamp automation frontier to ceiling at initialization
  let I = Math.min(p.currentAutomation, ceiling);
  let totalTasks = 1.0;
  let cumulativeProductivity = 1.0;
  let cumulativeOutputDemand = 1.0;
  let cumDisplacement = 0;
  let cumReinstatement = 0;
  let cumDemand = 0;

  // Fix 3: Guard against fully-automated occupations (division by zero)
  const initialHumanShare = Math.max((1 - I) / totalTasks, 1e-10);

  timeline.push({
    year: 0,
    automationFrontier: I,
    ceiling,
    totalTasks,
    humanTasks: totalTasks - I,
    humanTaskShare: initialHumanShare,
    productivityMultiplier: 1,
    outputDemandMultiplier: 1,
    employmentMultiplier: 1,
    employmentPctChange: 0,
    displacementEffect: 0,
    reinstatementEffect: 0,
    demandEffect: 0,
  });

  for (let t = 1; t <= years; t++) {
    // Ceiling expands (AI capabilities improve over time)
    ceiling = Math.min(ceiling + p.ceilingGrowthRate * (1 - ceiling), 1.0);

    // Adoption: close a fraction of the gap between current automation and ceiling
    // This gives logistic-style S-curve adoption
    const gap = Math.max(ceiling - I, 0);
    const tasksAutomated = p.adoptionSpeed * gap;
    I += tasksAutomated;

    // New tasks created (performed by humans)
    const newTasks = p.newTaskRate * totalTasks;
    totalTasks += newTasks;

    const humanTasks = totalTasks - I;
    const humanTaskShare = humanTasks / totalTasks;

    // Productivity
    cumulativeProductivity *= p.humanProductivityGrowth;

    // Demand expansion (Jevons effect)
    // Fix 5: Include automation's cost reduction in overall productivity
    const automationProductivityBoost = 1 + tasksAutomated / Math.max(humanTasks, 1e-10);
    const overallProductivity = p.humanProductivityGrowth * automationProductivityBoost;
    const yearlyDemandGrowth = Math.pow(overallProductivity, p.demandElasticity);
    cumulativeOutputDemand *= yearlyDemandGrowth;

    // Employment multiplier = shareRatio × outputDemand / productivity
    const shareRatio = humanTaskShare / initialHumanShare;
    const employmentMultiplier = shareRatio * cumulativeOutputDemand / cumulativeProductivity;

    // Fix 1 & 6: Log-based decomposition that sums exactly to log(employmentMultiplier)
    // ln(emp) = ln(share) + ln(demand) - ln(prod)
    // share change decomposes into displacement (I grows) and reinstatement (totalTasks grows)
    const prevYear = timeline[timeline.length - 1];
    const prevHumanTasks = prevYear.humanTasks;
    const prevTotalTasks = prevYear.totalTasks;

    const logDisplacement = Math.log(Math.max(humanTasks, 1e-10) / Math.max(prevHumanTasks, 1e-10))
                          - Math.log(totalTasks / prevTotalTasks);
    const logReinstatement = Math.log(totalTasks / prevTotalTasks);
    const logDemand = Math.log(yearlyDemandGrowth);
    const logProductivity = Math.log(p.humanProductivityGrowth);

    cumDisplacement += logDisplacement * 100;
    cumReinstatement += logReinstatement * 100;
    cumDemand += (logDemand - logProductivity) * 100;

    timeline.push({
      year: t,
      automationFrontier: I,
      ceiling,
      totalTasks,
      humanTasks,
      humanTaskShare,
      productivityMultiplier: cumulativeProductivity,
      outputDemandMultiplier: cumulativeOutputDemand,
      employmentMultiplier,
      employmentPctChange: (employmentMultiplier - 1) * 100,
      displacementEffect: cumDisplacement,
      reinstatementEffect: cumReinstatement,
      demandEffect: cumDemand,
    });
  }

  const finalYear = timeline[timeline.length - 1];

  return {
    soc: group.soc,
    name: group.name,
    baselineEmployment: group.employment,
    timeline,
    finalPctChange: finalYear.employmentPctChange,
    finalEmployment: group.employment * finalYear.employmentMultiplier,
  };
}

export function simulateAll(
  overrides: Record<string, Partial<TaskDistribution>>,
  years: number
): GroupResult[] {
  return socGroups.map((g) =>
    simulateGroup(g, overrides[g.soc] || {}, years)
  );
}

export function sensitivitySweep(
  group: SOCGroup,
  overrides: Partial<TaskDistribution>,
  paramName: keyof TaskDistribution,
  range: number[],
  years: number
): { paramValue: number; pctChange: number }[] {
  return range.map((val) => {
    const params = { ...overrides, [paramName]: val };
    const result = simulateGroup(group, params, years);
    return { paramValue: val, pctChange: result.finalPctChange };
  });
}

/** Total US employment across all 22 SOC groups */
export const totalUSEmployment = socGroups.reduce((s, g) => s + g.employment, 0);

/**
 * Tornado chart data: for each parameter, compute employment change at ±1σ
 * (paramValue × 0.5 and × 1.5) relative to default, holding others constant.
 */
export function tornadoAnalysis(
  group: SOCGroup,
  overrides: Partial<TaskDistribution>,
  years: number
): { param: keyof TaskDistribution; label: string; low: number; high: number; base: number }[] {
  const params: TaskDistribution = { ...group.defaults, ...overrides };
  const baseResult = simulateGroup(group, overrides, years);
  const base = baseResult.finalPctChange;

  const paramDefs: { key: keyof TaskDistribution; label: string; lowMult: number; highMult: number }[] = [
    { key: "demandElasticity", label: "Demand Elasticity", lowMult: 0.5, highMult: 1.5 },
    { key: "adoptionSpeed", label: "Adoption Speed", lowMult: 0.5, highMult: 1.5 },
    { key: "newTaskRate", label: "New Task Rate", lowMult: 0.5, highMult: 1.5 },
    { key: "ceilingGrowthRate", label: "Ceiling Growth", lowMult: 0.5, highMult: 1.5 },
    { key: "humanProductivityGrowth", label: "Productivity Growth", lowMult: 0.5, highMult: 1.5 },
  ];

  return paramDefs.map(({ key, label, lowMult, highMult }) => {
    const baseVal = params[key];
    // For humanProductivityGrowth, scale the *growth portion* (val - 1), not the whole multiplier
    const lowVal = key === "humanProductivityGrowth"
      ? 1 + (baseVal - 1) * lowMult
      : baseVal * lowMult;
    const highVal = key === "humanProductivityGrowth"
      ? 1 + (baseVal - 1) * highMult
      : baseVal * highMult;

    const lowResult = simulateGroup(group, { ...overrides, [key]: lowVal }, years);
    const highResult = simulateGroup(group, { ...overrides, [key]: highVal }, years);

    return {
      param: key,
      label,
      low: lowResult.finalPctChange,
      high: highResult.finalPctChange,
      base,
    };
  }).sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
}
