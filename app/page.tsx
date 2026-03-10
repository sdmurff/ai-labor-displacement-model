"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, AreaChart, Area, Cell,
  LineChart, Line,
} from "recharts";
import {
  socGroups,
  simulateAll,
  sensitivitySweep,
  tornadoAnalysis,
  totalUSEmployment,
  PARAM_PROVENANCE,
  DEMAND_ELASTICITY_PRESETS,
  type TaskDistribution,
  type GroupResult,
  type ParamSource,
} from "./model";

type ParamOverrides = Record<string, Partial<TaskDistribution>>;

const SENSITIVITY_PARAMS: { key: keyof TaskDistribution; label: string; range: number[]; fmt: (v: number) => string }[] = [
  { key: "adoptionSpeed", label: "Adoption Speed", range: Array.from({ length: 20 }, (_, i) => 0.01 + i * 0.015), fmt: (v) => `${(v * 100).toFixed(0)}%/yr` },
  { key: "demandElasticity", label: "Demand Elasticity", range: Array.from({ length: 20 }, (_, i) => 0.1 + i * 0.2), fmt: (v) => v.toFixed(1) },
  { key: "newTaskRate", label: "New Task Rate", range: Array.from({ length: 20 }, (_, i) => i * 0.005), fmt: (v) => `${(v * 100).toFixed(1)}%/yr` },
  { key: "ceilingGrowthRate", label: "Ceiling Growth", range: Array.from({ length: 20 }, (_, i) => i * 0.005), fmt: (v) => `${(v * 100).toFixed(1)}%/yr` },
  { key: "humanProductivityGrowth", label: "Productivity Growth", range: Array.from({ length: 20 }, (_, i) => 1.0 + i * 0.015), fmt: (v) => `${((v - 1) * 100).toFixed(1)}%/yr` },
];

// ─── Design tokens ──────────────────────────────────────────────────────────

const BASE_YEAR = 2026;

const C = {
  rust: "#c44d2b",
  rustLight: "#faf0ec",
  navy: "#2b4c7e",
  navyLight: "#edf2f8",
  sage: "#3a7d5c",
  sageLight: "#ecf5f0",
  ochre: "#b8860b",
  ochreLight: "#faf5e8",
  ink: "#1a1a2e",
  inkSec: "#4a4a68",
  inkTert: "#8888a4",
  surface0: "#f6f5f1",
  surface1: "#ffffff",
  surface2: "#f0efeb",
  border: "#e2e0d8",
  borderStrong: "#ccc9be",
} as const;

// ─── Components ─────────────────────────────────────────────────────────────

function ProvenanceBadge({ source }: { source: ParamSource }) {
  const styles: Record<ParamSource, { bg: string; fg: string; label: string }> = {
    data: { bg: "#e0f0e6", fg: "#2d6a3e", label: "DATA" },
    derived: { bg: "#e8ecf4", fg: "#3a5078", label: "DERIVED" },
    assumed: { bg: "#faf0e0", fg: "#8a6a0a", label: "ASSUMED" },
  };
  const s = styles[source];
  return (
    <span
      className="inline-block text-[8px] font-bold tracking-[0.06em] px-1.5 py-0.5 rounded ml-1.5"
      style={{ background: s.bg, color: s.fg, lineHeight: 1 }}
      title={PARAM_PROVENANCE[Object.keys(PARAM_PROVENANCE).find(
        (k) => PARAM_PROVENANCE[k as keyof TaskDistribution].source === source
      ) as keyof TaskDistribution]?.citation ?? ""}
    >
      {s.label}
    </span>
  );
}

function ProvenanceTag({ paramKey }: { paramKey: keyof TaskDistribution }) {
  const prov = PARAM_PROVENANCE[paramKey];
  return <ProvenanceBadge source={prov.source} />;
}

function TooltipInfo({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block ml-1" style={{ verticalAlign: "middle" }}>
      <button
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center justify-center rounded-full"
        style={{
          width: 14, height: 14, fontSize: 9, fontWeight: 700,
          background: C.surface2, color: C.inkTert, border: `1px solid ${C.border}`,
          cursor: "pointer", lineHeight: 1,
        }}
        aria-label="More info"
      >
        ?
      </button>
      {open && (
        <div
          style={{
            position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
            width: 260, padding: "10px 12px",
            background: C.surface1, border: `1px solid ${C.border}`, borderRadius: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)",
            zIndex: 50, fontSize: 11, lineHeight: 1.5, color: C.inkSec,
          }}
        >
          {text}
          <div style={{
            position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%) rotate(45deg)",
            width: 10, height: 10, background: C.surface1, borderRight: `1px solid ${C.border}`,
            borderBottom: `1px solid ${C.border}`,
          }} />
        </div>
      )}
    </div>
  );
}

function Slider({
  label, value, onChange, min, max, step, suffix = "", helpText, tooltip, provenanceKey,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; suffix?: string; helpText?: string; tooltip?: string;
  provenanceKey?: keyof TaskDistribution;
}) {
  const decimals = step < 0.005 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return (
    <div className="mb-4">
      <div className="flex justify-between items-baseline mb-1">
        <div className="flex items-center">
          <label className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: C.inkSec }}>{label}</label>
          {provenanceKey && <ProvenanceTag paramKey={provenanceKey} />}
          {tooltip && <TooltipInfo text={tooltip} />}
        </div>
        <span className="font-mono text-xs font-semibold" style={{ color: C.navy }}>
          {value.toFixed(decimals)}{suffix}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
      {helpText && <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: C.inkTert }}>{helpText}</p>}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border p-5 ${className}`}
      style={{ background: C.surface1, borderColor: C.border, boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 6px 24px rgba(0,0,0,0.03)" }}
    >
      {children}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-semibold uppercase tracking-wider mt-3 mb-1.5" style={{ color: C.inkTert }}>
      {children}
    </div>
  );
}

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h3 className="font-serif text-[17px] font-medium" style={{ color: C.ink }}>{children}</h3>
      {sub && <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: C.inkTert }}>{sub}</p>}
    </div>
  );
}

function StatCard({ label, value, positive, sub }: { label: string; value: string; positive: boolean; sub?: string }) {
  const bg = positive ? C.sageLight : C.rustLight;
  const fg = positive ? C.sage : C.rust;
  return (
    <div className="rounded-xl p-3.5 border" style={{ background: bg, borderColor: positive ? "#d4e8dc" : "#f0ddd6" }}>
      <div className="text-[9px] font-bold uppercase tracking-[0.08em] mb-1" style={{ color: C.inkTert }}>{label}</div>
      <div className="font-mono text-xl font-bold" style={{ color: fg }}>{value}</div>
      {sub && <div className="text-[10px] font-mono mt-0.5" style={{ color: C.inkSec }}>{sub}</div>}
    </div>
  );
}

function fmt(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtEmp(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toFixed(0);
}

function AdoptionBar({ observed, ceiling, zeta }: { observed: number; ceiling: number; zeta: number }) {
  const maxVal = Math.max(zeta, 1);
  return (
    <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: C.surface2 }}>
      <div className="absolute h-full rounded-full" style={{ width: `${(zeta / maxVal) * 100}%`, background: "rgba(196,77,43,0.15)" }} />
      <div className="absolute h-full rounded-full" style={{ width: `${(ceiling / maxVal) * 100}%`, background: "rgba(43,76,126,0.2)" }} />
      <div className="absolute h-full rounded-full" style={{ width: `${(observed / maxVal) * 100}%`, background: C.navy }} />
    </div>
  );
}

/** Canvas-based radar chart */
function RadarPanel({
  results,
  selectedSoc,
  onSelect,
  ceilingMode,
}: {
  results: GroupResult[];
  selectedSoc: string;
  onSelect: (soc: string) => void;
  ceilingMode: "alpha" | "beta" | "zeta";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const data = useMemo(() => {
    return socGroups.map((g) => {
      const r = results.find((r) => r.soc === g.soc)!;
      const finalYear = r.timeline[r.timeline.length - 1];
      return {
        soc: g.soc,
        name: g.name,
        theoretical: finalYear.ceiling,
        observed: g.observed,
        simulated: finalYear.automationFrontier,
      };
    });
  }, [results]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = 600;
    const H = 600;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    const cx = W / 2;
    const cy = H / 2;
    const maxR = Math.min(W, H) / 2 - 80;
    const n = data.length;
    const angleStep = (Math.PI * 2) / n;
    const startAngle = -Math.PI / 2;

    ctx.clearRect(0, 0, W, H);

    // Grid circles
    const levels = [0.2, 0.4, 0.6, 0.8, 1.0];
    levels.forEach((lev) => {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * lev, 0, Math.PI * 2);
      ctx.strokeStyle = "#e2e0d8";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.fillStyle = "#8888a4";
      ctx.font = "10px var(--font-body), system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(lev.toFixed(1), cx + 4, cy - maxR * lev + 12);
    });

    // Axes and labels
    for (let i = 0; i < n; i++) {
      const angle = startAngle + i * angleStep;
      const x = cx + Math.cos(angle) * maxR;
      const y = cy + Math.sin(angle) * maxR;

      ctx.strokeStyle = "#e2e0d8";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();

      const labelR = maxR + 36;
      const lx = cx + Math.cos(angle) * labelR;
      const ly = cy + Math.sin(angle) * labelR;

      const isSelected = data[i].soc === selectedSoc;
      ctx.fillStyle = isSelected ? C.navy : "#4a4a68";
      ctx.font = isSelected
        ? "bold 10px var(--font-body), system-ui, sans-serif"
        : "10px var(--font-body), system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const words = data[i].name.split(/\s*&\s*/);
      if (words.length > 1) {
        ctx.fillText(words[0] + " &", lx, ly - 6);
        ctx.fillText(words[1], lx, ly + 6);
      } else {
        ctx.fillText(data[i].name, lx, ly);
      }
    }

    function drawPolygon(values: number[], fillColor: string, strokeColor: string, lw: number, dashed = false) {
      ctx.beginPath();
      values.forEach((v, i) => {
        const angle = startAngle + i * angleStep;
        const r = maxR * Math.min(v, 1);
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.setLineDash(dashed ? [6, 4] : []);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.setLineDash([]);

      values.forEach((v, i) => {
        const angle = startAngle + i * angleStep;
        const r = maxR * Math.min(v, 1);
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor;
        ctx.fill();
      });
    }

    // Theoretical (blue filled), Observed (red/coral filled), Simulated (ochre)
    drawPolygon(data.map((d) => d.theoretical), "rgba(100,149,237,0.25)", "rgba(70,119,207,0.8)", 1.5, false);
    drawPolygon(data.map((d) => d.observed), "rgba(220,100,100,0.30)", "rgba(200,80,80,0.8)", 1.5, false);
    drawPolygon(data.map((d) => d.simulated), "rgba(184,134,11,0.08)", "rgba(184,134,11,0.65)", 2);

  }, [data, selectedSoc]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const cx = 300, cy = 300, maxR = 220;
    const n = data.length;
    const angleStep = (Math.PI * 2) / n;
    const startAngle = -Math.PI / 2;

    let bestDist = 40;
    let bestSoc = "";
    for (let i = 0; i < n; i++) {
      const angle = startAngle + i * angleStep;
      const lx = cx + Math.cos(angle) * (maxR + 36);
      const ly = cy + Math.sin(angle) * (maxR + 36);
      const dist = Math.sqrt((mx - lx) ** 2 + (my - ly) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        bestSoc = data[i].soc;
      }
    }
    if (bestSoc) onSelect(bestSoc);
  }, [data, onSelect]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: 600, height: 600, maxWidth: "100%", cursor: "pointer" }}
        onClick={handleClick}
      />
      <div className="flex gap-6 justify-center mt-3 text-[11px]">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(70,119,207,0.8)" }} />
          <span style={{ color: C.inkSec }}>Theoretical AI coverage</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "rgba(200,80,80,0.8)" }} />
          <span style={{ color: C.inkSec }}>Observed AI coverage</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: C.ochre }} />
          <span style={{ color: C.inkSec }}>Simulated ({BASE_YEAR + (results[0]?.timeline.length - 1)})</span>
        </div>
      </div>
    </div>
  );
}

// ─── White Paper ────────────────────────────────────────────────────────────

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="font-serif text-[16px] leading-[1.75] space-y-5" style={{ color: C.inkSec }}>{children}</div>;
}

function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return <h2 id={id} className="font-serif text-[22px] font-medium pt-10 pb-2 border-b" style={{ color: C.ink, borderColor: C.border }}>{children}</h2>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="font-serif text-[18px] font-medium pt-6 pb-1" style={{ color: C.ink }}>{children}</h3>;
}

function Aside({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-5 my-6" style={{ background: C.navyLight, borderColor: "#d4dde8" }}>
      <div className="text-[14px] leading-[1.7]" style={{ color: "#3a5578" }}>{children}</div>
    </div>
  );
}

function ParamBox({ name, range, description }: { name: string; range: string; description: string }) {
  return (
    <div className="rounded-xl border p-4 mb-3" style={{ background: C.surface2, borderColor: C.border }}>
      <div className="flex justify-between items-baseline mb-1">
        <span className="font-semibold text-[14px]" style={{ color: C.ink }}>{name}</span>
        <span className="font-mono text-[12px]" style={{ color: C.inkTert }}>{range}</span>
      </div>
      <p className="text-[13px] leading-[1.6]" style={{ color: C.inkSec }}>{description}</p>
    </div>
  );
}

function WhitePaper({ onSwitchToSim, onSwitchToMemo }: { onSwitchToSim: () => void; onSwitchToMemo: () => void }) {
  return (
    <div className="max-w-[740px] mx-auto px-6 py-10">

      {/* Title block */}
      <div className="mb-12">
        <h1 className="font-serif text-[36px] font-medium leading-tight tracking-tight" style={{ color: C.ink }}>
          Will AI Take Our Jobs?
        </h1>
        <p className="font-serif text-[20px] mt-3 leading-snug" style={{ color: C.inkSec }}>
          A task-based simulation of AI&rsquo;s impact on employment across 22 occupation groups
        </p>
        <div className="flex gap-4 mt-5 text-[12px]" style={{ color: C.inkTert }}>
          <span>Acemoglu-Restrepo Framework</span>
          <span>&middot;</span>
          <span>Interactive Companion</span>
        </div>
      </div>

      {/* TOC */}
      <div className="rounded-xl border p-5 mb-10" style={{ background: C.surface1, borderColor: C.border }}>
        <div className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: C.inkTert }}>Contents</div>
        <nav className="space-y-1.5 text-[14px]">
          {[
            ["the-question", "The Big Question"],
            ["task-framework", "The Task-Based Framework"],
            ["three-forces", "Three Forces: Displacement, Reinstatement, and Demand"],
            ["jevons", "The Jevons Paradox"],
            ["data", "Where the Numbers Come From"],
            ["parameters", "Simulation Parameters"],
            ["what-it-shows", "What the Simulation Shows"],
            ["limitations", "What This Model Can\u2019t Tell You"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block hover:underline" style={{ color: C.navy }}>{label}</a>
          ))}
        </nav>
      </div>

      <Prose>

        {/* 1. The Big Question */}
        <H2 id="the-question">The Big Question</H2>

        <p>
          Every wave of technology provokes the same anxiety: <em>will machines replace us?</em> The spinning jenny displaced hand weavers. ATMs were supposed to eliminate bank tellers. Self-checkout was going to end cashier jobs. In each case, the fears were partly right and mostly wrong &mdash; the specific tasks changed, but employment generally grew.
        </p>
        <p>
          Now we have AI systems that can write code, draft legal briefs, diagnose medical images, and generate marketing copy. This feels different. These aren&rsquo;t machines replacing muscles; they&rsquo;re replacing <em>cognitive work</em> &mdash; the very thing humans retreated to when physical labor was automated.
        </p>
        <p>
          So will AI actually destroy jobs, or will history repeat itself? The honest answer is: <strong style={{ color: C.ink }}>it depends on a race between several forces</strong>, and the outcome differs dramatically across occupations. This simulation lets you explore that race.
        </p>

        {/* 2. The Task-Based Framework */}
        <H2 id="task-framework">The Task-Based Framework</H2>

        <p>
          The traditional way economists think about automation is simple: a machine replaces a worker, one for one. But MIT economists Daron Acemoglu and Pascual Restrepo proposed a more nuanced view in a series of influential papers (2018, 2019, 2022) that has become the dominant framework for analyzing AI and employment.
        </p>
        <p>
          Their key insight: <strong style={{ color: C.ink }}>jobs are not monolithic &mdash; they are bundles of tasks</strong>.
        </p>
        <p>
          A lawyer doesn&rsquo;t just &ldquo;do law.&rdquo; They research case precedent, draft motions, negotiate settlements, counsel anxious clients, appear in court, and manage junior associates. AI might excel at legal research and first-draft writing while being useless at courtroom persuasion and client hand-holding. So the question isn&rsquo;t &ldquo;will AI replace lawyers?&rdquo; but &ldquo;which <em>tasks</em> within lawyering will AI take over, and what happens to the rest?&rdquo;
        </p>
        <p>
          The framework imagines each occupation as a continuum of tasks, stretching from those most susceptible to automation on one end to those most resistant on the other. At any point in time, there&rsquo;s a <strong style={{ color: C.ink }}>frontier</strong> &mdash; a dividing line. Tasks below the frontier are automated; tasks above it are still done by humans.
        </p>

        <Aside>
          <strong>Think of it like a shoreline.</strong> AI is the rising tide. Some tasks are on low ground (routine, well-defined, data-rich) and get submerged first. Others are on high ground (creative, interpersonal, physically dexterous) and stay dry longer. But the tide level isn&rsquo;t the only thing that matters &mdash; new land can also be created.
        </Aside>

        <p>
          This task-based view explains something that blunt &ldquo;robots steal jobs&rdquo; models cannot: why employment often <em>grows</em> in occupations experiencing heavy automation. The answer lies in three competing forces.
        </p>

        {/* 3. Three Forces */}
        <H2 id="three-forces">Three Forces: Displacement, Reinstatement, and Demand</H2>

        <H3>Force 1: Displacement (pushes employment down)</H3>
        <p>
          This is the obvious one. When AI takes over a task previously done by a human, that&rsquo;s one fewer task requiring human labor. If a law firm uses AI to do legal research that previously required a junior associate, that associate has less to do. Across the economy, displacement reduces the share of tasks performed by humans, which directly reduces labor demand.
        </p>
        <p>
          In the simulation, displacement is driven by the <strong style={{ color: C.ink }}>automation frontier</strong> advancing &mdash; the fraction of tasks that shift from human to AI. Its pace depends on the adoption speed and how close the frontier is to its theoretical ceiling.
        </p>

        <H3>Force 2: Reinstatement / New Task Creation (pushes employment up)</H3>
        <p>
          This is the force most people miss. As AI takes over existing tasks, entirely new tasks emerge that didn&rsquo;t exist before &mdash; and these new tasks typically require humans.
        </p>
        <p>
          Historical examples are everywhere. The automobile eliminated horse-related jobs but created mechanics, traffic engineers, driving instructors, gas station attendants, and eventually an entire suburban economy. The internet wiped out travel agents and classified ad salespeople but spawned web developers, social media managers, SEO specialists, app designers, and content creators.
        </p>
        <p>
          With AI specifically, we&rsquo;re already seeing new tasks emerge: prompt engineering, AI safety research, model evaluation, AI-assisted design workflows, algorithmic auditing, and human-AI collaboration management. Acemoglu and Restrepo call this <strong style={{ color: C.ink }}>reinstatement</strong> &mdash; new tasks that &ldquo;reinstate&rdquo; humans into the production process.
        </p>
        <p>
          In the model, new tasks expand the total task space. Since AI hasn&rsquo;t automated these new tasks (they&rsquo;re, by definition, things humans just started doing), they dilute the automation fraction and increase the human share. The <em>new task rate</em> parameter controls how fast this happens.
        </p>

        <H3>Force 3: Demand Expansion (pushes employment up)</H3>
        <p>
          When AI makes workers more productive, the cost of output falls. And when costs fall, demand often increases. Sometimes demand increases so much that, despite each worker producing more, you actually need <em>more</em> workers to meet the increased demand.
        </p>
        <p>
          This is where the Jevons Paradox comes in &mdash; important enough to warrant its own section.
        </p>

        {/* 4. Jevons Paradox */}
        <H2 id="jevons">The Jevons Paradox</H2>

        <p>
          In 1865, English economist William Stanley Jevons observed something counterintuitive about coal. James Watt&rsquo;s improved steam engine used coal far more <em>efficiently</em> than its predecessors. You&rsquo;d expect coal consumption to fall. Instead, it skyrocketed. Why? Because the improved efficiency made steam power economically viable for thousands of new applications. The efficiency gains didn&rsquo;t reduce demand for coal &mdash; they <em>unleashed</em> it.
        </p>

        <Aside>
          <strong>The Jevons Paradox, stated simply:</strong> When technology makes a resource cheaper to use, we often end up using <em>more</em> of it, not less, because we find so many new things to do with it.
        </Aside>

        <p>
          The same logic applies to AI and labor. If AI makes legal research 10x faster, law firms don&rsquo;t just do the same amount of research with fewer people. They start doing research they never would have done before &mdash; deeper due diligence, broader precedent searches, research for smaller cases that previously couldn&rsquo;t justify the cost. Total demand for legal-research-adjacent work could actually increase.
        </p>
        <p>
          Whether the Jevons effect dominates depends on the <strong style={{ color: C.ink }}>demand elasticity</strong> &mdash; how much demand expands when costs fall:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong style={{ color: C.ink }}>Elasticity &gt; 1 (elastic):</strong> Demand grows faster than productivity. Despite each worker being more productive, you need <em>more</em> total workers. This is the Jevons effect in full force. Think of software development &mdash; better tools have made individual developers more productive, yet the number of developers has exploded because demand for software has grown even faster.</li>
          <li><strong style={{ color: C.ink }}>Elasticity = 1 (unit elastic):</strong> Demand and productivity grow at exactly the same rate. Employment stays roughly flat. Each worker does more, but there&rsquo;s proportionally more to do.</li>
          <li><strong style={{ color: C.ink }}>Elasticity &lt; 1 (inelastic):</strong> Demand doesn&rsquo;t grow as fast as productivity. You need fewer workers. Think of agriculture &mdash; tractors made farming vastly more productive, but people can only eat so much food, so farm employment plummeted.</li>
        </ul>
        <p>
          The crucial question for each occupation is: <em>is the demand for its output elastic or inelastic?</em> Knowledge work tends to be elastic (there&rsquo;s always more analysis to do, more code to write, more content to create). Physical services tend to be inelastic (you only need your lawn mowed once a week regardless of how cheap it gets).
        </p>

        {/* 5. Data Sources */}
        <H2 id="data">Where the Numbers Come From</H2>

        <p>
          The simulation is calibrated using three empirical data sources, covering 22 Standard Occupational Classification (SOC) major groups that span the entire U.S. labor market:
        </p>

        <H3>Current Automation: Anthropic Economic Index (2026)</H3>
        <p>
          Massenkoff and McCrory (2026) measured how much AI is <em>actually being used</em> in different occupations today, based on real-world usage patterns from Anthropic&rsquo;s Claude. This isn&rsquo;t a theoretical estimate of what <em>could</em> be automated &mdash; it&rsquo;s an empirical measurement of what <em>is</em> being automated right now. For example, Computer & Mathematical occupations show 35.8% of tasks with meaningful AI engagement, while Transportation occupations show just 0.2%.
        </p>

        <H3>Theoretical Ceiling: Eloundou et al. (2023)</H3>
        <p>
          Eloundou, Manning, Mishkin, and Rock (&ldquo;GPTs are GPTs&rdquo;) estimated the maximum fraction of tasks that <em>could theoretically</em> be automated by large language models, using both human expert raters and GPT-4 itself. They produced three estimates:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong style={{ color: C.ink }}>&alpha; (alpha):</strong> Tasks automatable by a direct LLM with no external tools. The most conservative estimate.</li>
          <li><strong style={{ color: C.ink }}>&beta; (beta):</strong> Tasks automatable with the LLM plus some complementary tools (code interpreters, search, etc.). The primary estimate used in the paper. This is the simulation&rsquo;s default ceiling.</li>
          <li><strong style={{ color: C.ink }}>&zeta; (zeta):</strong> Tasks automatable assuming all plausible AI-powered tools get built (E1+E2). The most aggressive estimate.</li>
        </ul>
        <p>
          The gap between current automation (Anthropic observed) and the theoretical ceiling (Eloundou &beta;) tells us how much <em>room</em> there is for further automation. Computer & Math occupations have a frontier at 35.8% with a &beta; ceiling of 63.4% &mdash; meaning roughly half the automatable tasks have already been adopted. Protective Service occupations sit at 2.9% with a ceiling of 25.9% &mdash; barely scratching the surface.
        </p>

        <H3>Employment: BLS Occupational Employment and Wage Statistics (2021)</H3>
        <p>
          The Bureau of Labor Statistics provides the baseline employment count for each SOC group. This lets us translate percentage changes into actual job numbers. Office & Administrative occupations are the largest group at 18.3 million workers; Agriculture is the smallest at 452,000.
        </p>

        {/* 6. Parameters */}
        <H2 id="parameters">Simulation Parameters</H2>

        <p>
          The simulation has seven adjustable parameters for each occupation group. Two are empirical (<strong style={{ color: C.ink }}>current automation</strong> and <strong style={{ color: C.ink }}>theoretical ceiling</strong>), and five are calibrated assumptions that you can adjust:
        </p>

        <div className="overflow-x-auto my-6">
          <table className="w-full text-[13px] border-collapse" style={{ color: C.ink }}>
            <thead>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <th className="text-left py-2 px-3 font-semibold">Parameter</th>
                <th className="text-left py-2 px-3 font-semibold">What it controls</th>
              </tr>
            </thead>
            <tbody>
              {/* Data (per-group only) */}
              <tr><td colSpan={2} className="pt-4 pb-1 px-3 text-[9px] font-semibold uppercase tracking-wider" style={{ color: C.inkTert }}>Data · per-group only</td></tr>
              {[
                ["Current Automation", "Where the automation frontier starts today (from observed data)"],
                ["Theoretical Ceiling", "Maximum automatable fraction (\u03B1/\u03B2/\u03B6 scenarios)"],
              ].map(([p, w], i) => (
                <tr key={`data-${i}`} className="border-b" style={{ borderColor: C.border }}>
                  <td className="py-2 px-3 font-semibold whitespace-nowrap">{p}</td>
                  <td className="py-2 px-3" style={{ color: C.inkSec }}>{w}</td>
                </tr>
              ))}
              {/* Displacement drivers */}
              <tr><td colSpan={2} className="pt-4 pb-1 px-3 text-[9px] font-semibold uppercase tracking-wider" style={{ color: C.inkTert }}>Displacement drivers</td></tr>
              {[
                ["Adoption Speed", "How fast the frontier closes the gap to the ceiling each year"],
                ["Ceiling Growth", "How fast AI capabilities push the ceiling higher over time"],
              ].map(([p, w], i) => (
                <tr key={`disp-${i}`} className="border-b" style={{ borderColor: C.border }}>
                  <td className="py-2 px-3 font-semibold whitespace-nowrap">{p}</td>
                  <td className="py-2 px-3" style={{ color: C.inkSec }}>{w}</td>
                </tr>
              ))}
              {/* Reinstatement */}
              <tr><td colSpan={2} className="pt-4 pb-1 px-3 text-[9px] font-semibold uppercase tracking-wider" style={{ color: C.inkTert }}>Reinstatement</td></tr>
              {[
                ["New Task Rate", "Annual rate of new human-requiring tasks (reinstatement)"],
              ].map(([p, w], i) => (
                <tr key={`rein-${i}`} className="border-b" style={{ borderColor: C.border }}>
                  <td className="py-2 px-3 font-semibold whitespace-nowrap">{p}</td>
                  <td className="py-2 px-3" style={{ color: C.inkSec }}>{w}</td>
                </tr>
              ))}
              {/* Demand expansion · Jevons */}
              <tr><td colSpan={2} className="pt-4 pb-1 px-3 text-[9px] font-semibold uppercase tracking-wider" style={{ color: C.inkTert }}>Demand expansion · Jevons</td></tr>
              {[
                ["Productivity Growth", "How much AI boosts output per human worker on remaining tasks"],
                ["Demand Elasticity", "How much demand expands when costs fall; >1 = Jevons wins"],
              ].map(([p, w], i) => (
                <tr key={`dem-${i}`} className="border-b" style={{ borderColor: C.border }}>
                  <td className="py-2 px-3 font-semibold whitespace-nowrap">{p}</td>
                  <td className="py-2 px-3" style={{ color: C.inkSec }}>{w}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p>
          Each parameter has a tooltip in the simulation sidebar explaining its range and effect. <strong style={{ color: C.ink }}>Global overrides</strong> set a uniform value across all 22 groups; <strong style={{ color: C.ink }}>per-group parameters</strong> let you fine-tune individual occupations. For full calibration details and empirical benchmarks, see the{" "}
          <button onClick={onSwitchToMemo} className="underline font-semibold" style={{ color: C.navy }}>
            Technical Memo
          </button>.
        </p>

        {/* 7. What the Simulation Shows */}
        <H2 id="what-it-shows">What the Simulation Shows</H2>

        <p>
          The mathematical heart of the model is straightforward. At each time step, three things happen:
        </p>
        <ol className="list-decimal pl-6 space-y-2">
          <li>The automation frontier advances toward the ceiling (displacement).</li>
          <li>New human tasks expand the total task space (reinstatement).</li>
          <li>Productivity gains feed through demand elasticity to expand or contract output demand.</li>
        </ol>
        <p>
          Employment then follows a simple formula:
        </p>

        <div className="rounded-xl border p-5 my-6 text-center" style={{ background: C.surface2, borderColor: C.border }}>
          <div className="font-mono text-[15px]" style={{ color: C.ink }}>
            Employment = (Human Task Share / Initial Share) &times; (Output Demand / Productivity)
          </div>
          <p className="text-[12px] mt-2" style={{ color: C.inkTert }}>
            If the human share shrinks (displacement wins), employment falls. If demand grows faster than productivity (Jevons wins), employment rises. The net effect is the race between these forces.
          </p>
        </div>

        <p>
          Under the default calibration (using &beta; ceilings and sector-appropriate parameters), several patterns emerge:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong style={{ color: C.ink }}>Knowledge work shows the most dramatic tension.</strong> These occupations face the highest displacement (large gap between observed and ceiling) but also benefit most from the Jevons effect (elastic demand, high productivity gains, more new tasks). The outcome hinges on the elasticity assumption.</li>
          <li><strong style={{ color: C.ink }}>Manual/physical occupations are relatively insulated.</strong> Low observed automation, low ceilings, and low ceiling growth mean these jobs face little displacement. But they also see minimal Jevons-driven growth.</li>
          <li><strong style={{ color: C.ink }}>The ceiling scenario matters enormously.</strong> Switching from &alpha; (LLM only) to &zeta; (full tools) can flip an occupation from net growth to net decline, because the theoretical headroom for automation roughly triples.</li>
          <li><strong style={{ color: C.ink }}>New task creation is decisive.</strong> Setting the new task rate to zero (no reinstatement) produces uniformly dire results. Even modest reinstatement (1&ndash;2% per year) substantially softens displacement.</li>
        </ul>

        <p>
          You can test these patterns yourself in the{" "}
          <button onClick={onSwitchToSim} className="underline font-semibold" style={{ color: C.navy }}>
            interactive simulation
          </button>.
          Try setting adoption speed to zero for a group and watch displacement vanish. Set the new task rate to zero and see reinstatement disappear. Crank demand elasticity above 2 and watch the Jevons effect dominate.
        </p>

        {/* 8. Limitations */}
        <H2 id="limitations">What This Model Can&rsquo;t Tell You</H2>

        <p>
          This is a pedagogical tool for exploring how different forces interact &mdash; not a prediction engine. Keep these limitations in mind:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong style={{ color: C.ink }}>The key assumptions are uncertain.</strong> We have solid data for where automation <em>is</em> today and where it <em>could</em> go. But how fast it gets there, how many new tasks emerge, and how much demand expands are educated guesses. That&rsquo;s what the sensitivity analysis is for.</li>
          <li><strong style={{ color: C.ink }}>Each occupation group is a big bucket.</strong> &ldquo;Computer & Math&rdquo; lumps together software developers and actuaries. The real-world variation within each group is enormous.</li>
          <li><strong style={{ color: C.ink }}>Workers don&rsquo;t move between groups.</strong> In reality, displaced workers shift to other occupations. This model treats each group independently.</li>
          <li><strong style={{ color: C.ink }}>No wages, just headcount.</strong> Even if employment grows, wages could change. This model doesn&rsquo;t capture that.</li>
          <li><strong style={{ color: C.ink }}>No policy response.</strong> Retraining programs, regulation, AI taxes, UBI &mdash; none of these are modeled.</li>
        </ul>

        <p>
          Despite these limits, the model is valuable because it makes the <em>structure</em> of the debate explicit. Instead of arguing from anecdotes, you can specify your assumptions and see what follows. For a deeper look at the technical caveats, see the{" "}
          <button onClick={onSwitchToMemo} className="underline font-semibold" style={{ color: C.navy }}>
            Technical Memo
          </button>.
        </p>

      </Prose>

      <div className="border-t mt-16 pt-8 pb-12 text-center" style={{ borderColor: C.border }}>
        <button
          onClick={onSwitchToSim}
          className="font-semibold text-[14px] px-6 py-3 rounded-xl transition-all duration-150"
          style={{ background: C.navy, color: "#fff" }}
        >
          Open the Interactive Simulation &rarr;
        </button>
      </div>
    </div>
  );
}

// ─── Technical Memo ─────────────────────────────────────────────────────────

function TechnicalMemo({ onSwitchToSim }: { onSwitchToSim: () => void }) {
  return (
    <div className="max-w-[740px] mx-auto px-6 py-10">

      <div className="mb-12">
        <h1 className="font-serif text-[36px] font-medium leading-tight tracking-tight" style={{ color: C.ink }}>
          Technical Memo
        </h1>
        <p className="font-serif text-[20px] mt-3 leading-snug" style={{ color: C.inkSec }}>
          Parameter calibration, empirical benchmarks, and data provenance
        </p>
        <div className="flex gap-4 mt-5 text-[12px]" style={{ color: C.inkTert }}>
          <span>Last updated: March 2026</span>
        </div>
      </div>

      {/* TOC */}
      <div className="rounded-xl border p-5 mb-10" style={{ background: C.surface1, borderColor: C.border }}>
        <div className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: C.inkTert }}>Contents</div>
        {[
          ["exposure-data", "1. Exposure data: Eloundou et al. (2023)"],
          ["radar-replication", "2. Radar chart replication vs. Anthropic"],
          ["demand-elasticity", "3. Demand elasticity calibration"],
          ["productivity-growth", "4. Human productivity growth"],
          ["new-task-creation", "5. New task creation (reinstatement)"],
          ["adoption-speed", "6. Adoption speed"],
          ["observed-exposure", "7. Observed exposure data"],
          ["limitations", "8. Model limitations & technical caveats"],
          ["full-references", "9. Full references"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="block text-[13px] py-0.5 font-serif hover:underline" style={{ color: C.navy }}>{label}</a>
        ))}
      </div>

      <Prose>

        {/* ── Section 1: Exposure Data ── */}
        <H2 id="exposure-data">1. Exposure Data: Eloundou et al. (2023)</H2>
        <p>
          The simulation&rsquo;s theoretical automation ceilings come from Eloundou, Manning, Mishkin, &amp; Rock (2023), who scored every O*NET task on whether an LLM could reduce completion time by at least 50%. Two independent rater pools&mdash;human experts and GPT-4&mdash;evaluated each task, producing three exposure measures:
        </p>
        <div className="overflow-x-auto my-6">
          <table className="w-full text-[13px] border-collapse" style={{ color: C.ink }}>
            <thead>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <th className="text-left py-2 px-3 font-semibold">Measure</th>
                <th className="text-left py-2 px-3 font-semibold">Formula</th>
                <th className="text-left py-2 px-3 font-semibold">Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3 font-mono">&alpha;</td>
                <td className="py-2 px-3">E1</td>
                <td className="py-2 px-3">Direct LLM exposure only</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3 font-mono">&beta;</td>
                <td className="py-2 px-3">E1 + 0.5 &times; E2</td>
                <td className="py-2 px-3">LLM + partial complementary tools</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3 font-mono">&zeta;</td>
                <td className="py-2 px-3">E1 + E2</td>
                <td className="py-2 px-3">All plausible AI-powered tools (most aggressive)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Aside>
          <strong>Notation note:</strong> The source CSV file (<code>occ_level.csv</code> from the <code>openai/GPTs-are-GPTs</code> GitHub repo) labels the E1+E2 column as &ldquo;gamma.&rdquo; The paper itself uses &zeta; (zeta). We follow the paper&rsquo;s notation throughout.
        </Aside>
        <p>
          Our aggregation method: for each SOC major group, we compute the employment-weighted average of (GPT-4 rater + human rater) / 2 across all detailed occupations in that group. This is Eloundou et al.&rsquo;s primary methodology.
        </p>

        {/* ── Section 2: Radar Chart ── */}
        <H2 id="radar-replication">2. Radar Chart Replication vs. Anthropic</H2>
        <p>
          Our radar chart replicates Figure 2 from Massenkoff &amp; McCrory (2026) but does not perfectly match. Both charts use the same underlying Eloundou et al. exposure scores, but differ in <strong style={{ color: C.ink }}>how task-level scores are aggregated</strong> up to the 22 SOC major groups.
        </p>

        <H3>What Anthropic calls &ldquo;Beta&rdquo; is effectively Zeta</H3>
        <p>
          Anthropic&rsquo;s paper says they plot &ldquo;&beta; from Eloundou et al.&rdquo; but they binarize it as a gate: &ldquo;is &beta; &ge; 0.5?&rdquo; Since &beta; can only take values 0, 0.5, or 1, the gate captures all tasks where &beta; = 0.5 or &beta; = 1.0&mdash;which is mathematically equivalent to &zeta; (E1+E2):
        </p>
        <div className="overflow-x-auto my-6">
          <table className="w-full text-[13px] border-collapse" style={{ color: C.ink }}>
            <thead>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <th className="text-left py-2 px-3 font-semibold">Scenario</th>
                <th className="text-center py-2 px-3 font-semibold">&beta;</th>
                <th className="text-center py-2 px-3 font-semibold">𝟙&#123;&beta; &ge; 0.5&#125;</th>
                <th className="text-center py-2 px-3 font-semibold">&zeta;</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Not exposed</td>
                <td className="text-center py-2 px-3">0</td>
                <td className="text-center py-2 px-3 font-bold">0</td>
                <td className="text-center py-2 px-3 font-bold">0</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Exposed with tools</td>
                <td className="text-center py-2 px-3">0.5</td>
                <td className="text-center py-2 px-3 font-bold">1</td>
                <td className="text-center py-2 px-3 font-bold">1</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Directly exposed</td>
                <td className="text-center py-2 px-3">1</td>
                <td className="text-center py-2 px-3 font-bold">1</td>
                <td className="text-center py-2 px-3 font-bold">1</td>
              </tr>
            </tbody>
          </table>
        </div>

        <H3>Aggregation difference</H3>
        <div className="overflow-x-auto my-6">
          <table className="w-full text-[13px] border-collapse" style={{ color: C.ink }}>
            <thead>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <th className="text-left py-2 px-3 font-semibold">Dimension</th>
                <th className="text-left py-2 px-3 font-semibold">Our replication</th>
                <th className="text-left py-2 px-3 font-semibold">Anthropic&rsquo;s chart</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Source data</td>
                <td className="py-2 px-3">Eloundou et al. (2023) <code>occ_level.csv</code></td>
                <td className="py-2 px-3">Same</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Rater scores</td>
                <td className="py-2 px-3">Avg of GPT-4 + human raters</td>
                <td className="py-2 px-3">Same</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Measure plotted</td>
                <td className="py-2 px-3">&zeta; (E1+E2)</td>
                <td className="py-2 px-3">Binarized &beta; gate &equiv; &zeta;</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Within-occupation weighting</td>
                <td className="py-2 px-3">Equal (Eloundou&rsquo;s method)</td>
                <td className="py-2 px-3">Time-fraction (Claude-estimated)</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Cross-occupation weighting</td>
                <td className="py-2 px-3">BLS employment</td>
                <td className="py-2 px-3">BLS employment</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Reproducible from public data?</td>
                <td className="py-2 px-3">Yes</td>
                <td className="py-2 px-3">No (requires ~800 Claude API calls)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Anthropic uses <strong style={{ color: C.ink }}>time-fraction weights</strong> from Tamkin &amp; McCrory (2025), where Claude estimates how many hours per week a worker spends on each O*NET task. These weights are not publicly available. This produces slightly higher theoretical coverage for knowledge-intensive occupations (e.g., Computer &amp; Math: 94% vs. our 92%, Office &amp; Admin: 90% vs. our 81%) because within those jobs, workers spend disproportionate time on high-exposure cognitive tasks.
        </p>
        <p>
          Differences are typically 1&ndash;5 percentage points. Physical and manual occupations show nearly identical values under both methods.
        </p>

        {/* ── Section 3: Demand Elasticity ── */}
        <H2 id="demand-elasticity">3. Demand Elasticity Calibration</H2>
        <p>
          Demand elasticity (&epsilon;) is the single most influential parameter in the simulation. It captures the <strong style={{ color: C.ink }}>Jevons paradox</strong>: when automation lowers the cost of a task, does demand expand enough to offset the labor savings? When &epsilon; &gt; 1, demand grows faster than productivity, and employment <em>rises</em> despite automation. When &epsilon; &lt; 1, automation displaces workers faster than new demand absorbs them.
        </p>

        <H3>Historical benchmarks</H3>
        <div className="overflow-x-auto my-6">
          <table className="w-full text-[13px] border-collapse" style={{ color: C.ink }}>
            <thead>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <th className="text-left py-2 px-3 font-semibold">Historical case</th>
                <th className="text-center py-2 px-3 font-semibold">Est. &epsilon;</th>
                <th className="text-left py-2 px-3 font-semibold">Source</th>
                <th className="text-left py-2 px-3 font-semibold">Key finding</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["ATMs &amp; bank tellers", "~1.0", "Autor (2015, pp.&thinsp;6\u20137)", "Tellers/branch fell &gt;&#8531; (1988\u20132004), but branches rose &gt;40%. Net teller employment grew from 500K to 550K (1980\u20132010)."],
                ["Textile automation (19th c.)", "&gt;1&rarr;&lt;1", "Bessen (2019, pp.&thinsp;20\u201321, Table&nbsp;1C)", "Price elasticity starts &gt;1 (1820) then declines below 1 (1950). Demand concave w.r.t. productivity\u2014confirmed by F-tests."],
                ["Computing/IT (1980s\u20132000s)", "2.0\u20133.0+", "Bessen (2019, p.&thinsp;7)", "Massive demand expansion. Demand elasticity lifecycle: industries start elastic, become inelastic as markets saturate."],
                ["Manufacturing robots", "0.18\u20130.34 pp", "Acemoglu &amp; Restrepo (2020, pp.&thinsp;3\u20134)", "One robot per 1,000 workers reduces employment/population by 0.18\u20130.34 pp; wages by 0.25\u20130.5%. Preferred estimate: 0.34 pp."],
                ["E-discovery in legal", "&lt;1.0", "Autor (2015, p.&thinsp;27)", "Automation reduced paralegals; no offsetting demand surge for legal services."],
                ["Acemoglu AI baseline", "&sigma;=0.5", "Acemoglu (2024, p.&thinsp;7)", "Inter-task elasticity &sigma;&asymp;0.5 (citing Humlum 2023). TFP &le;0.71% total over 10 years (p.&thinsp;4), upper bound 0.55% adjusted for easy/hard tasks (p.&thinsp;5)."],
              ].map(([c, e, s, f], i) => (
                <tr key={i} className="border-b" style={{ borderColor: C.border }}>
                  <td className="py-2 px-3" dangerouslySetInnerHTML={{ __html: c }}></td>
                  <td className="text-center py-2 px-3 font-mono" dangerouslySetInnerHTML={{ __html: e }}></td>
                  <td className="py-2 px-3 whitespace-nowrap" dangerouslySetInnerHTML={{ __html: s }}></td>
                  <td className="py-2 px-3 text-[12px]" style={{ color: C.inkSec }} dangerouslySetInnerHTML={{ __html: f }}></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <H3>Our calibration</H3>
        <p>
          We set demand elasticity defaults conservatively, centered near 1.0 for knowledge work and below 1.0 for service and manual sectors. This follows Acemoglu&rsquo;s (2024) central case, which argues AI produces &ldquo;so-so automation&rdquo;&mdash;cost savings that are real but insufficient to trigger Jevons-scale demand expansion in most sectors.
        </p>
        <div className="overflow-x-auto my-6">
          <table className="w-full text-[13px] border-collapse" style={{ color: C.ink }}>
            <thead>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <th className="text-left py-2 px-3 font-semibold">Sector</th>
                <th className="text-center py-2 px-3 font-semibold">Base &epsilon;</th>
                <th className="text-center py-2 px-3 font-semibold">&beta; scaling</th>
                <th className="text-center py-2 px-3 font-semibold">Typical range</th>
                <th className="text-left py-2 px-3 font-semibold">Rationale</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Knowledge</td>
                <td className="text-center py-2 px-3 font-mono">0.8</td>
                <td className="text-center py-2 px-3 font-mono">+ &beta; &times; 0.4</td>
                <td className="text-center py-2 px-3 font-mono">1.0&ndash;1.1</td>
                <td className="py-2 px-3 text-[12px]" style={{ color: C.inkSec }}>Near-unit elasticity. Some demand expansion from cheaper analysis/code but bounded by organizational constraints.</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Service</td>
                <td className="text-center py-2 px-3 font-mono">0.5</td>
                <td className="text-center py-2 px-3 font-mono">+ &beta; &times; 0.4</td>
                <td className="text-center py-2 px-3 font-mono">0.5&ndash;0.7</td>
                <td className="py-2 px-3 text-[12px]" style={{ color: C.inkSec }}>Inelastic demand. Automating admin tasks doesn&rsquo;t proportionally increase demand for admin services.</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Manual</td>
                <td className="text-center py-2 px-3 font-mono">0.2</td>
                <td className="text-center py-2 px-3 font-mono">+ &beta; &times; 0.4</td>
                <td className="text-center py-2 px-3 font-mono">0.2&ndash;0.3</td>
                <td className="py-2 px-3 text-[12px]" style={{ color: C.inkSec }}>Highly inelastic. Physical tasks have limited scope for AI cost reduction and demand expansion.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Aside>
          <strong>Bessen&rsquo;s lifecycle insight:</strong> Demand elasticity is not fixed&mdash;it follows a lifecycle. New technologies start with high elasticity (untapped markets, rapidly falling costs) that declines as demand saturates. Early computing had &epsilon; &gt; 3; mature IT is closer to 1. If AI follows this pattern, current elasticities may be higher than our defaults suggest, but will decline over time. Users can explore this with the slider.
        </Aside>

        <H3>Cross-sector evidence</H3>
        <p>
          Nordhaus (2021) provides macroeconomic evidence that the elasticity of substitution between information-intensive and other sectors is consistently <strong style={{ color: C.ink }}>less than 1</strong>. This means Baumol&rsquo;s cost disease dominates at the aggregate level: slow-growing &ldquo;handicraft&rdquo; sectors pull down aggregate growth rather than fast-growing IT sectors pulling it up. This supports conservative defaults.
        </p>

        {/* ── Section 4: Human Productivity Growth ── */}
        <H2 id="productivity-growth">4. Human Productivity Growth</H2>
        <p>
          This parameter captures how much AI boosts the productivity of <em>remaining human tasks</em>&mdash;the augmentation channel. Unlike displacement (which shifts tasks from human to machine), augmentation makes humans better at the tasks they keep.
        </p>

        <H3>Empirical benchmarks</H3>
        <div className="overflow-x-auto my-6">
          <table className="w-full text-[13px] border-collapse" style={{ color: C.ink }}>
            <thead>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <th className="text-left py-2 px-3 font-semibold">Benchmark</th>
                <th className="text-center py-2 px-3 font-semibold">Rate</th>
                <th className="text-left py-2 px-3 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["US labor productivity, long-run average (1947\u20132024)", "1.5\u20132.1%/yr", "BLS Productivity Statistics"],
                ["US labor productivity, 2010\u20132019 (\u201cslowdown\u201d era)", "1.1%/yr", "BLS Productivity Statistics"],
                ["Tamkin &amp; McCrory (2025) AI productivity estimate", "1.8%/yr", "Economy-wide total, not per-occupation (p.&thinsp;14)"],
                ["Acemoglu (2024) AI TFP estimate (10-year)", "&le;0.71%", "Upper bound (p.&thinsp;4); adjusted for easy/hard tasks: &le;0.55% (p.&thinsp;5). ~0.07%/yr."],
                ["Acemoglu (2024) AI GDP estimate (10-year)", "1.1\u20131.8%", "Baseline 1.1% (p.&thinsp;4); with investment response 1.6\u20131.8% (p.&thinsp;4). Cost savings ~27% of labor costs (p.&thinsp;14)."],
              ].map(([b, r, s], i) => (
                <tr key={i} className="border-b" style={{ borderColor: C.border }}>
                  <td className="py-2 px-3" dangerouslySetInnerHTML={{ __html: b }}></td>
                  <td className="text-center py-2 px-3 font-mono" dangerouslySetInnerHTML={{ __html: r }}></td>
                  <td className="py-2 px-3 text-[12px]" style={{ color: C.inkSec }} dangerouslySetInnerHTML={{ __html: s }}></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <H3>Our calibration</H3>
        <p>
          We scale human productivity growth by sector type and theoretical exposure (&beta;). The logic: AI-driven productivity gains on remaining human tasks are proportional to how much AI touches the occupation.
        </p>
        <div className="overflow-x-auto my-6">
          <table className="w-full text-[13px] border-collapse" style={{ color: C.ink }}>
            <thead>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <th className="text-left py-2 px-3 font-semibold">Sector</th>
                <th className="text-center py-2 px-3 font-semibold">Base rate</th>
                <th className="text-center py-2 px-3 font-semibold">At high &beta; (0.65)</th>
                <th className="text-center py-2 px-3 font-semibold">At low &beta; (0.13)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Knowledge</td>
                <td className="text-center py-2 px-3 font-mono">4%</td>
                <td className="text-center py-2 px-3 font-mono">2.6%/yr</td>
                <td className="text-center py-2 px-3 font-mono">0.5%/yr</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Service</td>
                <td className="text-center py-2 px-3 font-mono">2.5%</td>
                <td className="text-center py-2 px-3 font-mono">1.6%/yr</td>
                <td className="text-center py-2 px-3 font-mono">0.3%/yr</td>
              </tr>
              <tr className="border-b" style={{ borderColor: C.border }}>
                <td className="py-2 px-3">Manual</td>
                <td className="text-center py-2 px-3 font-mono">1%</td>
                <td className="text-center py-2 px-3 font-mono">0.7%/yr</td>
                <td className="text-center py-2 px-3 font-mono">0.1%/yr</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          These are deliberately conservative. Tamkin &amp; McCrory&rsquo;s 1.8%/yr is an economy-wide <em>total</em> (including displacement), not a per-occupation augmentation rate. Acemoglu&rsquo;s 0.53&ndash;0.66% TFP figure over 10 years implies annual augmentation well below 1%.
        </p>

        {/* ── Section 5: New Task Creation ── */}
        <H2 id="new-task-creation">5. New Task Creation (Reinstatement)</H2>
        <p>
          Acemoglu &amp; Restrepo (2019) identify reinstatement&mdash;the creation of new tasks where humans have comparative advantage&mdash;as the primary counterweight to displacement. Without it, any positive rate of automation eventually eliminates all labor.
        </p>
        <p>
          Empirically, Acemoglu &amp; Restrepo (2019) estimate that between 1947 and 2017, new task creation offset roughly half of the displacement effect from automation. Their decomposition shows displacement accelerated after the 1980s while reinstatement weakened&mdash;contributing to wage stagnation and declining labor share.
        </p>
        <p>
          Our defaults range from 0.5%/yr (manual) to 2%/yr (knowledge), scaled by theoretical exposure. These are assumed values&mdash;there is no reliable per-occupation estimate of future new task creation rates.
        </p>

        {/* ── Section 6: Adoption Speed ── */}
        <H2 id="adoption-speed">6. Adoption Speed</H2>
        <p>
          Adoption speed controls how quickly the automation frontier advances toward the theoretical ceiling. We model this as a logistic gap-closing dynamic: each year, a fraction of the remaining gap between current automation and the ceiling is closed. This produces an S-curve&mdash;fast initial adoption that naturally decelerates as the frontier approaches its limit.
        </p>
        <p>
          Base rates: 12%/yr (knowledge), 8%/yr (service), 5%/yr (manual), adjusted by the ratio of current observed automation to theoretical ceiling (higher adoption momentum &rarr; faster speed). These produce realistic adoption trajectories: a knowledge occupation with a 50-point gap narrows by ~6 points in year 1, ~5.6 in year 2, etc.
        </p>

        {/* ── Section 7: Observed Exposure ── */}
        <H2 id="observed-exposure">7. Observed Exposure Data</H2>
        <p>
          The &ldquo;observed&rdquo; values come from Massenkoff &amp; McCrory (2026), available on HuggingFace (<code>Anthropic/EconomicIndex</code>). Their measure of observed exposure is:
        </p>
        <div className="rounded-xl border p-4 my-6 font-mono text-[13px]" style={{ background: C.surface2, borderColor: C.border, color: C.ink }}>
          r&#771;<sub>t</sub> = 𝟙&#123;WorkUsage &ge; 100&#125; &times; 𝟙&#123;&beta;<sub>t</sub> &ge; 0.5&#125; &times; &alpha;<sub>t</sub>
        </div>
        <p>
          This is an <strong style={{ color: C.ink }}>upper bound on true automation</strong>. It includes both automated (AI replacing human labor) and augmented (AI assisting human labor) uses of Claude. The &alpha;<sub>t</sub> term weights automated uses more heavily, but augmented uses still contribute. Users should interpret observed exposure as a ceiling on the &ldquo;current automation&rdquo; parameter, not a precise measurement of task displacement.
        </p>

        {/* ── Section 8: Model Limitations ── */}
        <H2 id="limitations">8. Model Limitations &amp; Technical Caveats</H2>
        <p>
          Beyond the conceptual limitations noted in the Guide, several technical issues affect interpretation:
        </p>

        <H3>Observed exposure overstates displacement</H3>
        <p>
          Massenkoff &amp; McCrory&rsquo;s &ldquo;observed&rdquo; exposure includes both automation and augmentation usage, weighted by &alpha;<sub>t</sub> (0.5 = pure augmentation, 1.0 = pure automation). Using it directly as the initial automation frontier I<sub>0</sub> is an <strong style={{ color: C.ink }}>upper bound</strong>. The augmentation portion actually contributes to productivity growth, not displacement.
        </p>

        <H3>Demand elasticity lacks calibration</H3>
        <p>
          The most influential parameter (&epsilon;) is set by heuristic, not empirical estimation. Acemoglu &amp; Restrepo (2019) implicitly assume &epsilon; &asymp; 1. Bessen (2019) documents historical ranges from 0.5 (textiles) to 3+ (computing). The simulation&rsquo;s per-sector defaults are starting points &mdash; use the presets and slider to explore sensitivity.
        </p>

        <H3>No wage dynamics</H3>
        <p>
          This is a quantity-only model: employment changes assume elastic labor supply at constant wages. A proper wage model requires CES labor market structure with skill heterogeneity and relative wage dynamics (Katz &amp; Murphy, 1992). Even in occupations where employment grows, wages could fall if the nature of remaining work changes.
        </p>

        <H3>Constant annual rates</H3>
        <p>
          The model uses constant annual rates for adoption, new task creation, and productivity growth. In reality, these rates may accelerate, decelerate, or shift discontinuously as AI capabilities evolve. Bessen&rsquo;s lifecycle insight (Section 3) suggests demand elasticity in particular is not fixed but follows a technology lifecycle.
        </p>

        <H3>Why we net BLS projections with this model</H3>
        <p>
          The bar chart adds the BLS 2024&ndash;34 baseline projection (prorated) to this model&rsquo;s AI effect. This is justified because <strong style={{ color: C.ink }}>BLS explicitly does not model AI&rsquo;s impact</strong>. From the BLS Employment Projections 2024&ndash;2034 Technical Note:
        </p>
        <Aside>
          &ldquo;BLS assumes that labor productivity and technological progress will be in line with the historical experience&hellip; In a future state where technology advances much more rapidly than it has historically, it is unlikely that historical relationships would hold, and therefore BLS projection methods are unlikely to yield reasonable results.&rdquo;
          <br /><br />
          &ldquo;If this higher rate of productivity growth is uniform across all industries, there is no impact on BLS employment projections&hellip; BLS has no data on which to base these differential productivity impacts. BLS therefore chooses to present a scenario with technological progress in line with historical patterns.&rdquo;
        </Aside>
        <p>
          In other words, BLS projections capture demographics, industry trends, and pre-AI technology trajectories &mdash; but treat AI as a non-event. Our model captures <em>only</em> the AI-specific displacement, reinstatement, and demand effects. The two are complementary, not overlapping, which makes netting them a valid (if approximate) combined forecast.
        </p>
        <p>
          BLS also notes that &ldquo;technology impacts occupations, but that these changes tend to be gradual, not sudden&rdquo; &mdash; consistent with our S-curve adoption model. For details, see Machovec, Rieley, &amp; Rolen (2025), &ldquo;Incorporating AI impacts in BLS employment projections: occupational case studies,&rdquo; <em>Monthly Labor Review</em>.
        </p>

        <H3>Partial double-counting caveat</H3>
        <p>
          Despite the general BLS stance above, the 2024&ndash;34 projections <em>do</em> incorporate AI adjustments for a handful of specific occupations. Machovec, Rieley, &amp; Rolen (2025) document that starting with the 2023&ndash;33 cycle, BLS began making targeted, occupation-level AI adjustments using a three-step methodology: (1) identify occupations with AI-exposed tasks, (2) determine the direction and magnitude of impact via analyst judgment, and (3) adjust the projected growth rate.
        </p>
        <p>
          The affected SOC major groups in the 2024&ndash;34 vintage include:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-[14px]" style={{ color: C.inkSec }}>
          <li><strong>13 &mdash; Business &amp; Finance:</strong> Claims adjusters (&minus;4.4%), insurance appraisers, credit analysts (&minus;3.9%), personal financial advisors</li>
          <li><strong>15 &mdash; Computer &amp; Math:</strong> Software developers (+17.9% in 2023&ndash;33, <em>boosted</em> by AI-driven demand &mdash; a Jevons effect), database administrators, database architects</li>
          <li><strong>23 &mdash; Legal:</strong> Lawyers, paralegals and legal assistants</li>
          <li><strong>41 &mdash; Sales:</strong> Selected customer-facing roles</li>
          <li><strong>43 &mdash; Office &amp; Admin:</strong> Selected clerical roles</li>
        </ul>
        <p>
          For these five groups, the bar chart&rsquo;s &ldquo;BLS + AI effect&rdquo; waterfall partially double-counts the AI signal. Comparing pre-AI (2022&ndash;32) vs. post-AI (2023&ndash;33) BLS projections gives a rough sense of the adjustment magnitude:
        </p>
        <table className="text-[13px] w-full border-collapse my-3" style={{ color: C.inkSec }}>
          <thead>
            <tr className="border-b-2" style={{ borderColor: C.border }}>
              <th className="text-left py-1.5 pr-3">SOC Group</th>
              <th className="text-right py-1.5 px-3">2022&ndash;32</th>
              <th className="text-right py-1.5 px-3">2023&ndash;33</th>
              <th className="text-right py-1.5 px-3">2024&ndash;34</th>
              <th className="text-right py-1.5 pl-3">&Delta; (raw)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b" style={{ borderColor: C.border, background: C.surface0 }}>
              <td className="py-1.5 pr-3 font-medium" colSpan={5}>AI-adjusted groups</td>
            </tr>
            <tr className="border-b" style={{ borderColor: C.border }}>
              <td className="py-1.5 pr-3">15 &mdash; Computer &amp; Math</td>
              <td className="text-right py-1.5 px-3">+15.2%</td>
              <td className="text-right py-1.5 px-3">+12.9%</td>
              <td className="text-right py-1.5 px-3">+10.1%</td>
              <td className="text-right py-1.5 pl-3">&minus;5.1 pp</td>
            </tr>
            <tr className="border-b" style={{ borderColor: C.border }}>
              <td className="py-1.5 pr-3 pl-4 text-[12px]">Software developers</td>
              <td className="text-right py-1.5 px-3">+25.7%</td>
              <td className="text-right py-1.5 px-3">+17.9%</td>
              <td className="text-right py-1.5 px-3">&mdash;</td>
              <td className="text-right py-1.5 pl-3">&minus;7.8 pp</td>
            </tr>
            <tr className="border-b" style={{ borderColor: C.border }}>
              <td className="py-1.5 pr-3">41 &mdash; Sales</td>
              <td className="text-right py-1.5 px-3">&minus;2.6%</td>
              <td className="text-right py-1.5 px-3">&minus;2.0%</td>
              <td className="text-right py-1.5 px-3">&minus;2.0%</td>
              <td className="text-right py-1.5 pl-3">+0.6 pp</td>
            </tr>
            <tr className="border-b" style={{ borderColor: C.border }}>
              <td className="py-1.5 pr-3">43 &mdash; Office &amp; Admin</td>
              <td className="text-right py-1.5 px-3">&minus;6.2%</td>
              <td className="text-right py-1.5 px-3">&minus;3.5%</td>
              <td className="text-right py-1.5 px-3">&minus;3.9%</td>
              <td className="text-right py-1.5 pl-3">+2.3 pp</td>
            </tr>
            <tr className="border-b" style={{ borderColor: C.border, background: C.surface0 }}>
              <td className="py-1.5 pr-3 font-medium" colSpan={5}>Baseline</td>
            </tr>
            <tr className="border-b" style={{ borderColor: C.border }}>
              <td className="py-1.5 pr-3">Total, all occupations</td>
              <td className="text-right py-1.5 px-3">+2.8%</td>
              <td className="text-right py-1.5 px-3">+4.0%</td>
              <td className="text-right py-1.5 px-3">&mdash;</td>
              <td className="text-right py-1.5 pl-3">+1.2 pp</td>
            </tr>
          </tbody>
        </table>
        <p className="text-[13px] italic" style={{ color: C.inkTert }}>
          Sources: Colato &amp; Ice (2023), BLS News Release USDL-24-1776 (2024), BLS Employment Projections 2024&ndash;34. &Delta; shows raw 2022&ndash;32 &rarr; 2023&ndash;33 change; adjust by &minus;1.2 pp for the baseline shift.
        </p>
        <p>
          Computer &amp; Math (SOC 15) stands out: it declined 2.3 pp in raw terms despite the economy-wide baseline <em>rising</em> 1.2 pp &mdash; an adjusted decline of ~3.5 pp. The trend continues into 2024&ndash;34 (+10.1%), suggesting ongoing downward revision. Meanwhile, Office &amp; Admin and Sales <em>improved</em> in raw terms, though after adjusting for the baseline shift, the changes are modest. The comparison is imperfect &mdash; base years differ and other economic factors changed &mdash; but it suggests the AI adjustment at the major-group level is on the order of a few percentage points. The double-count is therefore small relative to this model&rsquo;s total AI effect, but users should be aware of it for the five groups listed above.
        </p>
        <Aside>
          <strong>Jevons effect in BLS data:</strong> Notably, BLS <em>boosted</em> software developer projections for AI-driven demand (new code generation, AI tool development), even while reducing projections for other IT roles. This mirrors exactly the demand-expansion channel (&epsilon; &gt; 1) in our model &mdash; empirical validation that automation can increase employment in elastic-demand occupations.
        </Aside>

        {/* ── Section 9: Full References ── */}
        <H2 id="full-references">9. Full References</H2>
        <div className="text-[14px] leading-[1.8] space-y-3" style={{ color: C.inkSec }}>
          <p>
            Acemoglu, D. (2025). The Simple Macroeconomics of AI. <em>Economic Policy</em>, 40(121), 13&ndash;58. (NBER Working Paper 32487, 2024.)
          </p>
          <p>
            Acemoglu, D., &amp; Restrepo, P. (2018). Artificial Intelligence, Automation and Work. <em>NBER Working Paper 24196</em>.
          </p>
          <p>
            Acemoglu, D., &amp; Restrepo, P. (2018). The Race Between Man and Machine: Implications of Technology for Growth, Factor Shares, and Employment. <em>American Economic Review</em>, 108(6), 1488&ndash;1542.
          </p>
          <p>
            Acemoglu, D., &amp; Restrepo, P. (2019). Automation and New Tasks: How Technology Displaces and Reinstates Labor. <em>Journal of Economic Perspectives</em>, 33(2), 3&ndash;30.
          </p>
          <p>
            Acemoglu, D., &amp; Restrepo, P. (2020). Robots and Jobs: Evidence from US Labor Markets. <em>Journal of Political Economy</em>, 128(6), 2188&ndash;2244.
          </p>
          <p>
            Acemoglu, D., &amp; Restrepo, P. (2022). Tasks, Automation, and the Rise in US Wage Inequality. <em>Econometrica</em>, 90(5), 1973&ndash;2016.
          </p>
          <p>
            Autor, D. H. (2015). Why Are There Still So Many Jobs? The History and Future of Workplace Automation. <em>Journal of Economic Perspectives</em>, 29(3), 3&ndash;30.
          </p>
          <p>
            Bessen, J. (2015). <em>Learning by Doing: The Real Connection between Innovation, Wages, and Wealth</em>. Yale University Press.
          </p>
          <p>
            Bessen, J. (2019). Automation and Jobs: When Technology Boosts Employment. <em>Economic Policy</em>, 34(100), 589&ndash;626.
          </p>
          <p>
            Eloundou, T., Manning, S., Mishkin, P., &amp; Rock, D. (2023). GPTs are GPTs: An Early Look at the Labor Market Impact Potential of Large Language Models. <em>arXiv:2303.10130</em>.
          </p>
          <p>
            Jevons, W. S. (1865). <em>The Coal Question: An Inquiry Concerning the Progress of the Nation, and the Probable Exhaustion of our Coal-Mines</em>. Macmillan.
          </p>
          <p>
            Katz, L. F., &amp; Murphy, K. M. (1992). Changes in Relative Wages, 1963&ndash;1987: Supply and Demand Factors. <em>Quarterly Journal of Economics</em>, 107(1), 35&ndash;78.
          </p>
          <p>
            Labaschin, A. et al. (2025). Extending GPTs are GPTs to Firms. <em>American Economic Association</em>.
          </p>
          <p>
            Massenkoff, M., &amp; McCrory, P. (2026). Labor Market Impacts of AI: A New Measure and Early Evidence. Anthropic Research.
          </p>
          <p>
            Nordhaus, W. D. (2021). Are We Approaching an Economic Singularity? Information Technology and the Future of Economic Growth. <em>American Economic Journal: Macroeconomics</em>, 13(1), 299&ndash;332.
          </p>
          <p>
            Tamkin, A., &amp; McCrory, P. (2025). Estimating AI Productivity Gains from Claude Conversations. Anthropic Research.
          </p>
          <p>
            U.S. Bureau of Labor Statistics. (2021). Occupational Employment and Wage Statistics (OEWS), May 2021.
          </p>
          <p>
            U.S. Bureau of Labor Statistics. (2025). Employment Projections, 2024&ndash;2034. Technical Note.
          </p>
          <p>
            Machovec, C., Rieley, M. J., &amp; Rolen, E. (2025). Incorporating AI impacts in BLS employment projections: occupational case studies. <em>Monthly Labor Review</em>, U.S. Bureau of Labor Statistics.
          </p>
        </div>

      </Prose>

      <div className="border-t mt-16 pt-8 pb-12 text-center" style={{ borderColor: C.border }}>
        <button
          onClick={onSwitchToSim}
          className="font-semibold text-[14px] px-6 py-3 rounded-xl transition-all duration-150"
          style={{ background: C.navy, color: "#fff" }}
        >
          Open the Interactive Simulation &rarr;
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function Home() {
  const [activeTab, setActiveTab] = useState<"simulation" | "paper" | "memo">("simulation");
  const [years, setYears] = useState(0);
  const [selectedSoc, setSelectedSoc] = useState("15");
  const [sensitivityParam, setSensitivityParam] = useState<keyof TaskDistribution>("adoptionSpeed");
  const [ceilingMode, setCeilingMode] = useState<"alpha" | "beta" | "zeta">("zeta");

  const emptyOverrides = useMemo(() => {
    const o: ParamOverrides = {};
    socGroups.forEach((g) => { o[g.soc] = {}; });
    return o;
  }, []);

  const [overrides, setOverrides] = useState<ParamOverrides>(emptyOverrides);
  const [globalOverrides, setGlobalOverrides] = useState<Partial<TaskDistribution>>({});
  const hasGlobalOverrides = Object.keys(globalOverrides).length > 0;

  const effectiveOverrides = useMemo(() => {
    const adjusted: ParamOverrides = {};
    for (const g of socGroups) {
      const ceilOverride = { theoreticalCeiling: ceilingMode === "zeta" ? g.zeta : ceilingMode === "alpha" ? g.alpha : g.beta };
      adjusted[g.soc] = { ...globalOverrides, ...ceilOverride, ...overrides[g.soc] };
    }
    return adjusted;
  }, [overrides, globalOverrides, ceilingMode]);

  const globalDefaults = useMemo(() => {
    const totalEmp = socGroups.reduce((s, g) => s + g.employment, 0);
    const wavg = (key: keyof TaskDistribution) =>
      socGroups.reduce((s, g) => s + g.defaults[key] * g.employment, 0) / totalEmp;
    return {
      adoptionSpeed: wavg("adoptionSpeed"),
      ceilingGrowthRate: wavg("ceilingGrowthRate"),
      newTaskRate: wavg("newTaskRate"),
      humanProductivityGrowth: wavg("humanProductivityGrowth"),
      demandElasticity: wavg("demandElasticity"),
    };
  }, []);

  const globalRange = useMemo(() => {
    const minMax = (key: keyof TaskDistribution) => {
      const vals = socGroups.map((g) => g.defaults[key]);
      return { min: Math.min(...vals), max: Math.max(...vals) };
    };
    return {
      adoptionSpeed: minMax("adoptionSpeed"),
      ceilingGrowthRate: minMax("ceilingGrowthRate"),
      newTaskRate: minMax("newTaskRate"),
      humanProductivityGrowth: minMax("humanProductivityGrowth"),
      demandElasticity: minMax("demandElasticity"),
    };
  }, []);

  const updateParam = useCallback((soc: string, key: keyof TaskDistribution, value: number) => {
    setOverrides((prev) => ({
      ...prev,
      [soc]: { ...prev[soc], [key]: value },
    }));
  }, []);

  const updateGlobalParam = useCallback((key: keyof TaskDistribution, value: number) => {
    setGlobalOverrides((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetAll = useCallback(() => {
    setOverrides(emptyOverrides);
    setGlobalOverrides({});
    setCeilingMode("zeta");
  }, [emptyOverrides]);

  const results = useMemo(() => simulateAll(effectiveOverrides, years), [effectiveOverrides, years]);

  const sortedResults = useMemo(
    () => [...results].sort((a, b) => a.finalPctChange - b.finalPctChange),
    [results]
  );

  const selectedGroup = socGroups.find((g) => g.soc === selectedSoc)!;
  const selectedResult = results.find((r) => r.soc === selectedSoc)!;
  const effectiveParams: TaskDistribution = {
    ...selectedGroup.defaults,
    ...globalOverrides,
    ...{ theoreticalCeiling: ceilingMode === "zeta" ? selectedGroup.zeta : ceilingMode === "alpha" ? selectedGroup.alpha : selectedGroup.beta },
    ...overrides[selectedSoc],
  };

  const sensConfig = SENSITIVITY_PARAMS.find((p) => p.key === sensitivityParam)!;
  const sensitivityData = useMemo(() => {
    return sensitivitySweep(selectedGroup, effectiveOverrides[selectedSoc] || {}, sensitivityParam, sensConfig.range, years);
  }, [selectedGroup, effectiveOverrides, selectedSoc, sensitivityParam, sensConfig.range, years]);

  const tornadoData = useMemo(() => {
    return tornadoAnalysis(selectedGroup, effectiveOverrides[selectedSoc] || {}, years);
  }, [selectedGroup, effectiveOverrides, selectedSoc, years]);

  const BLS_YEARS = 10; // BLS projection covers 2024-2034
  const BLS_END = 2034;

  const totalFinal = results.reduce((s, r) => s + r.finalEmployment, 0);
  const totalPctChange = ((totalFinal / totalUSEmployment) - 1) * 100;

  const timelineData = selectedResult.timeline.map((yr) => ({
    year: BASE_YEAR + yr.year,
    employment: yr.employmentPctChange,
    displacement: yr.displacementEffect,
    reinstatement: yr.reinstatementEffect,
    demand: yr.demandEffect,
    automatedPct: yr.automationFrontier * 100,
    ceilingPct: yr.ceiling * 100,
    humanPct: (yr.humanTasks / yr.totalTasks) * 100,
  }));

  const knowledgeSOCs = ["11", "13", "15", "17", "19", "23", "25", "27"];
  const knowledgeBase = socGroups.filter((g) => knowledgeSOCs.includes(g.soc)).reduce((s, g) => s + g.employment, 0);
  const knowledgeFinal = results.filter((r) => knowledgeSOCs.includes(r.soc)).reduce((s, r) => s + r.finalEmployment, 0);
  const knowledgePct = ((knowledgeFinal / knowledgeBase) - 1) * 100;
  const otherBase = totalUSEmployment - knowledgeBase;
  const otherFinal = totalFinal - knowledgeFinal;
  const otherPct = ((otherFinal / otherBase) - 1) * 100;

  // BLS baseline (prorated) for comparison
  const blsTotalPct = socGroups.reduce((s, g) => s + g.blsProjectedGrowth * g.employment, 0) / totalUSEmployment * (years / BLS_YEARS);
  const blsKnowledgePct = socGroups.filter((g) => knowledgeSOCs.includes(g.soc)).reduce((s, g) => s + g.blsProjectedGrowth * g.employment, 0) / knowledgeBase * (years / BLS_YEARS);
  const blsOtherPct = socGroups.filter((g) => !knowledgeSOCs.includes(g.soc)).reduce((s, g) => s + g.blsProjectedGrowth * g.employment, 0) / otherBase * (years / BLS_YEARS);
  // Net = BLS + AI effect
  const netTotalPct = blsTotalPct + totalPctChange;
  const netKnowledgePct = blsKnowledgePct + knowledgePct;
  const netOtherPct = blsOtherPct + otherPct;

  return (
    <div className="min-h-screen" style={{ background: C.surface0 }}>

      {/* Header */}
      <header className="border-b sticky top-0 z-50" style={{ borderColor: C.border, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-[1440px] mx-auto px-6">
          <div className="flex items-end justify-between py-4">
            <div>
              <h1 className="font-serif text-[26px] font-medium tracking-tight" style={{ color: C.ink }}>
                AI & Employment
              </h1>
              <p className="text-[12px] mt-0.5 tracking-wide" style={{ color: C.inkTert }}>
                Acemoglu-Restrepo task-based framework &middot; 22 SOC groups
              </p>
            </div>
            <div className="hidden md:flex gap-1.5 items-center">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: C.sage }} />
              <span className="text-[11px] font-mono" style={{ color: C.inkTert }}>v2</span>
            </div>
          </div>
          <div className="flex gap-0 -mb-px">
            {([["simulation", "Simulation"], ["paper", "Overview"], ["memo", "Technical Memo"]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className="px-5 py-2.5 text-[13px] font-semibold border-b-2 transition-colors duration-150"
                style={activeTab === key
                  ? { borderColor: C.navy, color: C.navy }
                  : { borderColor: "transparent", color: C.inkTert }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {activeTab === "paper" ? (
        <WhitePaper onSwitchToSim={() => setActiveTab("simulation")} onSwitchToMemo={() => setActiveTab("memo")} />
      ) : activeTab === "memo" ? (
        <TechnicalMemo onSwitchToSim={() => setActiveTab("simulation")} />
      ) : (

      <div className="max-w-[1440px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">

          {/* ─── Sidebar ──────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Simulation controls */}
            <Card>
              <SectionTitle sub="Configure time horizon and ceiling scenario">Simulation</SectionTitle>
              <Slider
                label="Time Horizon" value={years} onChange={setYears}
                min={0} max={BLS_END - BASE_YEAR} step={1} suffix={` → ${BASE_YEAR + years}`}
                tooltip={`How many years into the future to project from ${BASE_YEAR}. Capped at ${BLS_END} to align with BLS projections. The model simulates year-by-year with compounding effects — adoption follows an S-curve, new tasks accumulate, and demand expands.`}
              />

              <div className="mb-4">
                <div className="flex items-center mb-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.inkSec }}>Ceiling Scenario</label>
                  <TooltipInfo text="Which Eloundou et al. estimate to use as the automation ceiling. α = direct LLM only (most conservative). β = LLM + partial tools like code interpreters (most commonly cited). ζ = all plausible AI tools built (most aggressive, default). Switching scenarios dramatically changes displacement headroom." />
                </div>
                <div className="flex gap-1.5">
                  {(["alpha", "beta", "zeta"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setCeilingMode(mode)}
                      className="flex-1 text-xs py-2 rounded-lg font-semibold transition-all duration-150"
                      style={ceilingMode === mode
                        ? { background: C.navy, color: "#fff", border: `1px solid ${C.navy}` }
                        : { background: C.surface2, color: C.inkSec, border: `1px solid ${C.border}` }
                      }
                    >
                      {mode === "alpha" ? "\u03B1 LLM" : mode === "beta" ? "\u03B2 Partial" : "\u03B6 Full"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Global overrides */}
              <div className="border-t pt-4 mt-1" style={{ borderColor: C.border }}>
                <div className="flex justify-between items-baseline mb-3">
                  <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.inkSec }}>Global Overrides</label>
                  {hasGlobalOverrides && (
                    <button onClick={() => setGlobalOverrides({})} className="text-[10px] font-semibold transition-colors" style={{ color: C.navy }}>
                      Clear
                    </button>
                  )}
                </div>
                {!hasGlobalOverrides && (
                  <p className="text-[10px] mb-3 leading-relaxed" style={{ color: C.inkTert }}>Drag any slider to override all 22 groups. Per-group defaults vary by sector.</p>
                )}
                <SubLabel>Displacement drivers</SubLabel>
                <Slider
                  label="Adoption Speed" value={globalOverrides.adoptionSpeed ?? globalDefaults.adoptionSpeed}
                  onChange={(v) => updateGlobalParam("adoptionSpeed", v)}
                  min={0} max={0.4} step={0.005} suffix="/yr"
                  helpText={globalOverrides.adoptionSpeed !== undefined ? "Overriding all 22 groups" : `Avg ${(globalDefaults.adoptionSpeed * 100).toFixed(0)}%/yr (range ${(globalRange.adoptionSpeed.min * 100).toFixed(0)}\u2013${(globalRange.adoptionSpeed.max * 100).toFixed(0)}%)`}
                  tooltip="Fraction of the gap between current automation and ceiling closed each year. Creates an S-curve: fast early adoption that slows near the ceiling. At 5%, a 40-point gap narrows by 2 points/year initially. Higher values = faster displacement but also faster productivity gains. Drives displacement and demand forces."
                />
                <Slider
                  label="Ceiling Growth" value={globalOverrides.ceilingGrowthRate ?? globalDefaults.ceilingGrowthRate}
                  onChange={(v) => updateGlobalParam("ceilingGrowthRate", v)}
                  min={0} max={0.1} step={0.005} suffix="/yr"
                  helpText={globalOverrides.ceilingGrowthRate !== undefined ? "Overriding all 22 groups" : "Default: 0%/yr \u2014 increase to model expanding AI capabilities"}
                  tooltip="How fast AI capabilities improve annually, pushing the theoretical ceiling higher. Applied to the remaining non-automatable fraction. At 0%, AI capabilities plateau at today's level. At 2\u20135%, the ceiling steadily rises, meaning new tasks become automatable over time. Drives displacement force."
                />
                <SubLabel>Reinstatement</SubLabel>
                <Slider
                  label="New Task Rate" value={globalOverrides.newTaskRate ?? globalDefaults.newTaskRate}
                  onChange={(v) => updateGlobalParam("newTaskRate", v)}
                  min={0} max={0.1} step={0.005} suffix="/yr"
                  helpText={globalOverrides.newTaskRate !== undefined ? "Overriding all 22 groups" : `Avg ${(globalDefaults.newTaskRate * 100).toFixed(1)}%/yr (range ${(globalRange.newTaskRate.min * 100).toFixed(1)}\u2013${(globalRange.newTaskRate.max * 100).toFixed(1)}%)`}
                  tooltip="Annual rate of new human-requiring tasks as a fraction of total tasks. This is Acemoglu & Restrepo's 'reinstatement' — the primary counterweight to displacement. At 0%, no new tasks emerge (pure displacement). At 2–3%, new task creation can partially or fully offset automation. Drives reinstatement force."
                />
                <SubLabel>Demand expansion · Jevons</SubLabel>
                <Slider
                  label="Productivity Growth" value={globalOverrides.humanProductivityGrowth ?? globalDefaults.humanProductivityGrowth}
                  onChange={(v) => updateGlobalParam("humanProductivityGrowth", v)}
                  min={1.0} max={1.5} step={0.01} suffix="x/yr"
                  helpText={globalOverrides.humanProductivityGrowth !== undefined ? "Overriding all 22 groups" : `Weighted avg ${(globalDefaults.humanProductivityGrowth).toFixed(2)}x/yr`}
                  tooltip="Annual productivity multiplier on remaining human tasks. Interacts with demand elasticity for the Jevons effect."
                />
                <Slider
                  label="Demand Elasticity" value={globalOverrides.demandElasticity ?? globalDefaults.demandElasticity}
                  onChange={(v) => updateGlobalParam("demandElasticity", v)}
                  min={0.1} max={4} step={0.1}
                  helpText={globalOverrides.demandElasticity !== undefined ? "Overriding all 22 groups" : `Avg ${globalDefaults.demandElasticity.toFixed(1)} (range ${globalRange.demandElasticity.min.toFixed(1)}\u2013${globalRange.demandElasticity.max.toFixed(1)})`}
                  tooltip="The Jevons parameter — how much output demand expands when productivity lowers costs. >1 (elastic): demand grows faster than productivity, employment rises despite automation. =1: demand and productivity balance. <1 (inelastic): productivity outpaces demand, fewer workers needed. Software dev is highly elastic (~2.5); accounting is inelastic (~0.8)."
                />
              </div>

              <button
                onClick={resetAll}
                className="w-full text-[11px] py-2 rounded-lg font-semibold transition-all duration-150 mt-2"
                style={{ background: C.surface2, color: C.inkSec, border: `1px solid ${C.border}` }}
              >
                Reset All to Defaults
              </button>

              {/* Summary stats moved to main panel */}
            </Card>

            {/* Per-group parameters */}
            <Card>
              <SectionTitle sub="Per-group sliders override global values">SOC Group Parameters</SectionTitle>

              <select
                value={selectedSoc}
                onChange={(e) => setSelectedSoc(e.target.value)}
                className="w-full p-2 rounded-lg text-sm mb-4 font-medium cursor-pointer"
                style={{ background: C.surface2, color: C.ink, border: `1px solid ${C.border}` }}
              >
                {socGroups.map((g) => (
                  <option key={g.soc} value={g.soc}>{g.name} ({g.soc})</option>
                ))}
              </select>

              {/* Data provenance */}
              <div className="rounded-xl p-3 mb-4 space-y-2" style={{ background: C.surface2, border: `1px solid ${C.border}` }}>
                {[
                  { label: "Observed (Anthropic) \u2191", value: `${(selectedGroup.observed * 100).toFixed(1)}%` },
                  { label: `Theoretical ${ceilingMode}`, value: `${(effectiveParams.theoreticalCeiling * 100).toFixed(1)}%` },
                  { label: "Theoretical \u03B6", value: `${(selectedGroup.zeta * 100).toFixed(1)}%` },
                  { label: "Adoption ratio", value: `${selectedGroup.beta > 0 ? ((selectedGroup.observed / selectedGroup.beta) * 100).toFixed(0) : 0}%` },
                  { label: "Employment", value: fmtEmp(selectedGroup.employment) },
                  { label: `BLS 2024–34 (${years}yr)`, value: `${selectedGroup.blsProjectedGrowth >= 0 ? "+" : ""}${(selectedGroup.blsProjectedGrowth * years / BLS_YEARS).toFixed(1)}%` },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between text-[10px]">
                    <span style={{ color: C.inkTert }}>{row.label}</span>
                    <span className="font-mono font-semibold" style={{ color: C.ink }}>{row.value}</span>
                  </div>
                ))}
                <AdoptionBar observed={selectedGroup.observed} ceiling={effectiveParams.theoreticalCeiling} zeta={selectedGroup.zeta} />
                <div className="flex justify-between text-[9px] font-medium">
                  <span style={{ color: C.navy }}>Observed</span>
                  <span style={{ color: C.inkTert }}>Ceiling</span>
                  <span style={{ color: C.rust }}>&zeta; max</span>
                </div>
                <div className="text-[9px] mt-1 leading-snug" style={{ color: C.ochre }}>
                  &uarr; Observed is an <strong>upper bound</strong> on automation &mdash; includes augmentation (human+AI tasks). True I&#8320; may be lower.
                </div>
              </div>

              <SubLabel>Data · per-group only</SubLabel>
              <Slider
                label="Current Automation" value={effectiveParams.currentAutomation}
                onChange={(v) => updateParam(selectedSoc, "currentAutomation", v)}
                min={0} max={0.8} step={0.005}
                provenanceKey="currentAutomation"
                helpText="Upper bound — includes augmentation (see note below)"
                tooltip="Starting point of the automation frontier from Anthropic's observed usage data. IMPORTANT: This is an upper bound on true automation because Massenkoff & McCrory's measure includes both automation AND augmentation (human+AI collaboration). The gap between this value and true automation represents tasks where AI assists but doesn't replace humans — contributing to productivity growth instead. Adjust downward to model lower true-automation share."
              />
              <Slider
                label="Theoretical Ceiling" value={effectiveParams.theoreticalCeiling}
                onChange={(v) => updateParam(selectedSoc, "theoreticalCeiling", v)}
                min={0} max={1} step={0.01}
                provenanceKey="theoreticalCeiling"
                helpText="Max automatable fraction from Eloundou et al."
                tooltip="Maximum fraction of tasks that could be automated given current/near-term AI. From Eloundou et al. estimates. The automation frontier cannot exceed this value (until the ceiling itself grows via Ceiling Growth). The gap between Current Automation and this ceiling determines how much displacement headroom remains."
              />
              <SubLabel>Displacement drivers</SubLabel>
              <Slider
                label="Adoption Speed" value={effectiveParams.adoptionSpeed}
                onChange={(v) => updateParam(selectedSoc, "adoptionSpeed", v)}
                min={0} max={0.4} step={0.005} suffix="/yr"
                provenanceKey="adoptionSpeed"
                helpText="Fraction of remaining gap closed per year (S-curve)"
                tooltip="Fraction of remaining automation gap closed annually. Creates S-curve dynamics — fast early adoption slowing near the ceiling. Default varies by sector: knowledge work ~12%, service ~8%, manual ~5%, adjusted by current adoption momentum. Drives displacement and demand forces."
              />
              <Slider
                label="Ceiling Growth" value={effectiveParams.ceilingGrowthRate}
                onChange={(v) => updateParam(selectedSoc, "ceilingGrowthRate", v)}
                min={0} max={0.1} step={0.005} suffix="/yr"
                provenanceKey="ceilingGrowthRate"
                helpText="Default: 0%/yr — increase to model expanding AI capabilities"
                tooltip="Annual expansion of the theoretical ceiling as AI capabilities improve. Default: 0%/yr — increase to model expanding AI capabilities. Higher values mean more tasks become automatable over time. Drives the displacement force."
              />
              <SubLabel>Reinstatement</SubLabel>
              <Slider
                label="New Task Rate" value={effectiveParams.newTaskRate}
                onChange={(v) => updateParam(selectedSoc, "newTaskRate", v)}
                min={0} max={0.1} step={0.005} suffix="/yr"
                provenanceKey="newTaskRate"
                helpText="Reinstatement: new human tasks created per year"
                tooltip="Annual new task creation rate — Acemoglu & Restrepo's 'reinstatement' effect. Default: knowledge 1–3%/yr scaled by exposure level, service 0.5–1.5%/yr, manual 0.1–0.5%/yr. The primary counterweight to displacement. Drives reinstatement force."
              />
              <SubLabel>Demand expansion · Jevons</SubLabel>
              <Slider
                label="Productivity Growth" value={effectiveParams.humanProductivityGrowth}
                onChange={(v) => updateParam(selectedSoc, "humanProductivityGrowth", v)}
                min={1.0} max={1.5} step={0.01} suffix="x/yr"
                provenanceKey="humanProductivityGrowth"
                helpText="Annual productivity multiplier on human tasks"
                tooltip="Annual multiplier on human worker productivity for remaining (non-automated) tasks. A lawyer using AI for research is faster — that's productivity growth. At 1.0x, no AI-driven gain. At 1.10x, humans are 10% more productive per year. Interacts with demand elasticity for the Jevons effect: higher productivity × higher elasticity = more demand expansion."
              />
              <Slider
                label="Demand Elasticity" value={effectiveParams.demandElasticity}
                onChange={(v) => updateParam(selectedSoc, "demandElasticity", v)}
                min={0.1} max={4} step={0.1}
                provenanceKey="demandElasticity"
                helpText="Jevons paradox: >1 elastic, <1 inelastic"
                tooltip="The Jevons parameter — how much output demand expands when productivity lowers costs. >1 (elastic): demand grows faster than productivity, employment rises despite automation. =1: balanced. <1 (inelastic): fewer workers needed. A&R (2019) implicitly ε≈1. Bessen (2019) range: 0.5–3+. Default varies by sector — ASSUMED, not calibrated."
              />
              {/* Demand Elasticity Presets */}
              <div className="flex gap-1 mt-1 mb-4">
                {Object.entries(DEMAND_ELASTICITY_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    onClick={() => updateParam(selectedSoc, "demandElasticity", preset.value)}
                    className="flex-1 text-[9px] py-1.5 rounded-md font-semibold transition-all duration-150"
                    style={Math.abs(effectiveParams.demandElasticity - preset.value) < 0.05
                      ? { background: C.navy, color: "#fff", border: `1px solid ${C.navy}` }
                      : { background: C.surface2, color: C.inkTert, border: `1px solid ${C.border}` }
                    }
                    title={preset.description}
                  >
                    {preset.label.split("(")[0].trim()}
                  </button>
                ))}
              </div>
            </Card>
          </div>

          {/* ─── Main Content ─────────────────────────────────────────── */}
          <div className="space-y-6">

            {/* Radar chart */}
            <Card>
              <SectionTitle sub={`Navy dashed = ceiling (${ceilingMode}). Rust = observed. Ochre = simulated at year ${years}. Click a label to select.`}>
                AI Task Coverage
              </SectionTitle>
              <div className="flex justify-center">
                <RadarPanel results={results} selectedSoc={selectedSoc} onSelect={setSelectedSoc} ceilingMode={ceilingMode} />
              </div>
            </Card>

            {/* Aggregate impact summary */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "All Occupations", bls: blsTotalPct, ai: totalPctChange, net: netTotalPct, emp: totalUSEmployment },
                { label: "Knowledge Work", bls: blsKnowledgePct, ai: knowledgePct, net: netKnowledgePct, emp: knowledgeBase },
                { label: "Other Occupations", bls: blsOtherPct, ai: otherPct, net: netOtherPct, emp: otherBase },
              ].map((d) => (
                <div key={d.label} className="rounded-xl p-4 border" style={{ background: d.net >= 0 ? C.sageLight : C.rustLight, borderColor: d.net >= 0 ? "#d4e8dc" : "#f0ddd6" }}>
                  <div className="text-[9px] font-bold uppercase tracking-[0.08em] mb-2" style={{ color: C.inkTert }}>{d.label}</div>
                  <div className="font-mono text-2xl font-bold mb-1" style={{ color: d.net >= 0 ? C.sage : C.rust }}>
                    {fmt(d.net)}
                  </div>
                  <div className="text-[10px] font-mono space-y-0.5" style={{ color: C.inkSec }}>
                    <div>{fmtEmp(d.emp)} base &middot; Net {Math.round(d.emp * d.net / 100).toLocaleString()} jobs</div>
                    <div style={{ color: C.ochre }}>BLS baseline: {fmt(d.bls)} ({Math.round(d.emp * d.bls / 100).toLocaleString()})</div>
                    <div style={{ color: d.ai >= 0 ? C.sage : C.rust }}>AI effect: {fmt(d.ai)} ({Math.round(d.emp * d.ai / 100).toLocaleString()})</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Bar chart */}
            <Card>
              <div className="flex justify-between items-start">
                <SectionTitle sub={`Ceiling: ${ceilingMode === "alpha" ? "\u03B1 (direct LLM only)" : ceilingMode === "beta" ? "\u03B2 (partial tools)" : "\u03B6 (full tools)"} \u00B7 Click bars to select`}>
                  Employment Change by {BASE_YEAR + years}
                </SectionTitle>
              </div>
              <ResponsiveContainer width="100%" height={600}>
                <BarChart
                  data={(() => {
                    const items = sortedResults.map((r) => {
                      const g = socGroups.find((g) => g.soc === r.soc)!;
                      const bls = g.blsProjectedGrowth * (years / BLS_YEARS);
                      const ai = r.finalPctChange;
                      const net = bls + ai;
                      return {
                        name: r.name,
                        soc: r.soc,
                        emp: r.baselineEmployment,
                        bls, ai, net,
                        // Range bars: [start, end] for each segment
                        blsRange: [0, bls] as [number, number],
                        aiRange: [Math.min(bls, net), Math.max(bls, net)] as [number, number],
                        // Track direction for coloring
                        aiPositive: ai >= 0,
                      };
                    });
                    return items.sort((a, b) => a.net - b.net);
                  })()}
                  layout="vertical"
                  margin={{ top: 5, right: 80, left: 10, bottom: 5 }}
                  barGap={-18}
                  onClick={(state: Record<string, unknown>) => {
                    const payload = state?.activePayload as Array<{ payload: { soc: string } }> | undefined;
                    if (payload?.[0]?.payload?.soc) {
                      setSelectedSoc(payload[0].payload.soc);
                    }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={C.border} />
                  <XAxis type="number" tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" width={175} tick={{ fontSize: 11 }} />
                  <Tooltip
                    content={({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload;
                      if (!d) return null;
                      return (
                        <div className="rounded-lg border p-2.5 text-[11px] shadow-lg" style={{ background: C.surface1, borderColor: C.border }}>
                          <div className="font-semibold mb-1.5" style={{ color: C.ink }}>{d.name}</div>
                          <div className="space-y-0.5">
                            <div style={{ color: C.ochre }}>BLS baseline: {fmt(d.bls)} ({Math.round(d.emp * d.bls / 100).toLocaleString()} jobs)</div>
                            <div style={{ color: d.ai >= 0 ? C.sage : C.rust }}>AI effect: {fmt(d.ai)} ({Math.round(d.emp * d.ai / 100).toLocaleString()} jobs)</div>
                            <div className="border-t pt-1 mt-1 font-semibold" style={{ borderColor: C.border, color: d.net >= 0 ? C.sage : C.rust }}>
                              Net: {fmt(d.net)} ({Math.round(d.emp * d.net / 100).toLocaleString()} jobs)
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    height={36}
                    content={() => (
                      <div className="flex items-center justify-center gap-5 text-[11px] pb-1" style={{ color: C.inkSec }}>
                        <span className="flex items-center gap-1.5">
                          <svg width="16" height="12"><rect width="16" height="12" fill="url(#hatch)" stroke="#999" strokeWidth="0.5" rx="2" /></svg>
                          BLS baseline (pre-AI)
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block w-4 h-3 rounded-sm" style={{ background: C.sage, opacity: 0.6 }} />
                          AI grows jobs
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block w-4 h-3 rounded-sm" style={{ background: C.rust, opacity: 0.6 }} />
                          AI shrinks jobs
                        </span>
                      </div>
                    )}
                  />
                  <defs>
                    <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <line x1="0" y1="0" x2="0" y2="6" stroke="#666" strokeWidth="1.5" opacity="0.45" />
                    </pattern>
                  </defs>
                  <ReferenceLine x={0} stroke={C.borderStrong} strokeWidth={1.5} />
                  {/* BLS baseline — hatched range bar from 0 to bls */}
                  <Bar dataKey="blsRange" barSize={18} fill="url(#hatch)" stroke="#999" strokeWidth={0.5} strokeOpacity={0.3} isAnimationActive={false} />
                  {/* AI effect — solid range bar from bls to net */}
                  <Bar
                    dataKey="aiRange"
                    barSize={18}
                    cursor="pointer"
                    label={({ x, y, width, height, index }: any) => {
                      const sorted = sortedResults.map((r) => {
                        const g = socGroups.find((g) => g.soc === r.soc)!;
                        const net = g.blsProjectedGrowth * (years / BLS_YEARS) + r.finalPctChange;
                        return { ...r, net };
                      }).sort((a, b) => a.net - b.net);
                      const item = sorted[index];
                      if (!item) return null;
                      const netJobs = Math.round(item.baselineEmployment * item.net / 100);
                      const sign = netJobs >= 0 ? "+" : "";
                      const label = Math.abs(netJobs) >= 1000
                        ? `${sign}${(netJobs / 1000).toFixed(0)}k`
                        : `${sign}${netJobs}`;
                      // Find the rightmost/leftmost edge of the full bar (at net position)
                      // For the label, we need the tip of the combined bar
                      const d = sorted[index];
                      const g = socGroups.find((g) => g.soc === d.soc)!;
                      const bls = g.blsProjectedGrowth * (years / BLS_YEARS);
                      // The AI range bar goes from min(bls,net) to max(bls,net)
                      // The net tip is at whichever end is further from zero
                      // If ai >= 0: net > bls, so tip is at x + width (right edge)
                      // If ai < 0: net < bls, so tip is at x (left edge)
                      const tipX = d.finalPctChange >= 0 ? x + width + 4 : x - 4;
                      return (
                        <text
                          x={tipX}
                          y={y + height / 2}
                          textAnchor={item.net >= 0 ? "start" : "end"}
                          dominantBaseline="central"
                          fontSize={9}
                          fontFamily="monospace"
                          fill={item.net >= 0 ? C.sage : C.rust}
                          opacity={0.8}
                        >
                          {label}
                        </text>
                      );
                    }}
                  >
                    {(() => {
                      const items = sortedResults.map((r) => {
                        const g = socGroups.find((g) => g.soc === r.soc)!;
                        const ai = r.finalPctChange;
                        const net = g.blsProjectedGrowth * (years / BLS_YEARS) + ai;
                        return { soc: r.soc, ai, net };
                      }).sort((a, b) => a.net - b.net);
                      return items.map((d, i) => (
                        <Cell
                          key={i}
                          fill={d.ai >= 0 ? C.sage : C.rust}
                          opacity={d.soc === selectedSoc ? 0.9 : 0.6}
                          stroke={d.soc === selectedSoc ? C.navy : "none"}
                          strokeWidth={d.soc === selectedSoc ? 2 : 0}
                        />
                      ));
                    })()}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-[10px] mt-2" style={{ color: C.inkTert }}>
                Hatched = BLS 2024&ndash;34 baseline (prorated to {years}yr). BLS projections largely exclude AI effects, making netting valid &mdash; though SOC 13, 15, 23, 41, 43 have partial AI adjustments (see Technical Memo). Solid = AI effect from simulation.
              </p>
            </Card>

            {/* Timeline row */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <Card>
                <SectionTitle sub="Year-by-year employment change from baseline">
                  {selectedGroup.name}: Trajectory
                </SectionTitle>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={timelineData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="year" />
                    <YAxis tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`]} />
                    <ReferenceLine y={0} stroke={C.borderStrong} strokeDasharray="4 3" />
                    <defs>
                      <linearGradient id="empGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.navy} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={C.navy} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="employment" name="Employment"
                      stroke={C.navy} strokeWidth={2.5} fill="url(#empGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <SectionTitle sub="Cumulative decomposition of employment effects">
                  {selectedGroup.name}: Three Forces
                </SectionTitle>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={timelineData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="year" />
                    <YAxis tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`]} />
                    <Legend verticalAlign="top" height={36} iconSize={10} />
                    <ReferenceLine y={0} stroke={C.borderStrong} strokeDasharray="4 3" />
                    <Line type="monotone" dataKey="displacement" name="Displacement"
                      stroke={C.rust} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="reinstatement" name="New Tasks"
                      stroke={C.sage} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="demand" name="Demand (Jevons)"
                      stroke={C.navy} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </div>

            {/* Automation + Summary row */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <Card>
                <SectionTitle sub="Adoption converges toward ceiling over time">
                  {selectedGroup.name}: Frontier vs. Ceiling
                </SectionTitle>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={timelineData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="year" />
                    <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                    <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`]} />
                    <Legend verticalAlign="top" height={36} iconSize={10} />
                    <Area type="monotone" dataKey="ceilingPct" name="Ceiling"
                      stroke={C.navy} strokeWidth={2} fill={C.navyLight} strokeDasharray="6 3" />
                    <Area type="monotone" dataKey="automatedPct" name="Frontier"
                      stroke={C.rust} strokeWidth={2} fill={C.rustLight} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              {/* Summary table */}
              <Card>
                <SectionTitle>Summary at {BASE_YEAR + years}</SectionTitle>
                <div className="overflow-y-auto max-h-[340px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0" style={{ background: C.surface1 }}>
                      <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                        <th className="text-left py-2 pr-1 font-semibold text-[10px] uppercase tracking-wide" style={{ color: C.inkTert }}>Group</th>
                        <th className="text-right py-2 px-1 font-semibold text-[10px] uppercase tracking-wide" style={{ color: C.inkTert }}>Obs</th>
                        <th className="text-right py-2 px-1 font-semibold text-[10px] uppercase tracking-wide" style={{ color: C.inkTert }}>Ceil</th>
                        <th className="text-right py-2 px-1 font-semibold text-[10px] uppercase tracking-wide" style={{ color: C.inkTert }}>Emp</th>
                        <th className="text-right py-2 px-1 font-semibold text-[10px] uppercase tracking-wide" style={{ color: C.ochre }}>BLS</th>
                        <th className="text-right py-2 pl-1 font-semibold text-[10px] uppercase tracking-wide" style={{ color: C.inkTert }}>Chg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedResults.map((r) => {
                        const g = socGroups.find((g) => g.soc === r.soc)!;
                        const ceil = ceilingMode === "zeta" ? g.zeta : ceilingMode === "alpha" ? g.alpha : g.beta;
                        const isSelected = r.soc === selectedSoc;
                        return (
                          <tr
                            key={r.soc}
                            className="cursor-pointer transition-colors duration-100"
                            style={{
                              borderBottom: `1px solid ${C.border}`,
                              background: isSelected ? C.navyLight : "transparent",
                            }}
                            onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = C.surface2; }}
                            onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                            onClick={() => setSelectedSoc(r.soc)}
                          >
                            <td className="py-2 pr-1 font-medium truncate max-w-[140px]" style={{ color: isSelected ? C.navy : C.ink }}>{r.name}</td>
                            <td className="py-2 px-1 text-right font-mono" style={{ color: C.inkTert }}>{(g.observed * 100).toFixed(0)}%</td>
                            <td className="py-2 px-1 text-right font-mono" style={{ color: C.inkTert }}>{(ceil * 100).toFixed(0)}%</td>
                            <td className="py-2 px-1 text-right font-mono" style={{ color: C.inkTert }}>{fmtEmp(r.baselineEmployment)}</td>
                            <td className="py-2 px-1 text-right font-mono" style={{ color: C.ochre }}>{g.blsProjectedGrowth >= 0 ? "+" : ""}{g.blsProjectedGrowth.toFixed(0)}%</td>
                            <td className="py-2 pl-1 text-right font-mono font-semibold" style={{ color: r.finalPctChange >= 0 ? C.sage : C.rust }}>
                              {fmt(r.finalPctChange)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr style={{ borderTop: `2px solid ${C.borderStrong}` }} className="font-semibold">
                        <td className="py-2 pr-1" style={{ color: C.ink }}>Total</td>
                        <td className="py-2 px-1" colSpan={2}></td>
                        <td className="py-2 px-1 text-right font-mono" style={{ color: C.inkSec }}>{fmtEmp(totalUSEmployment)}</td>
                        <td className="py-2 px-1 text-right font-mono" style={{ color: C.ochre }}>+2.8%</td>
                        <td className="py-2 pl-1 text-right font-mono" style={{ color: totalPctChange >= 0 ? C.sage : C.rust }}>
                          {fmt(totalPctChange)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] mt-2" style={{ color: C.inkTert }}>
                  Obs = observed. Ceil = ceiling ({ceilingMode}). BLS = pre-AI 2024–34 projection (full 10-yr). Click to select.
                </p>
              </Card>
            </div>

            {/* Sensitivity analysis */}
            <Card>
              <div className="flex justify-between items-start mb-4">
                <SectionTitle sub={`Employment change at ${BASE_YEAR + years} as one parameter varies`}>
                  Sensitivity: {selectedGroup.name}
                </SectionTitle>
                <select
                  value={sensitivityParam}
                  onChange={(e) => setSensitivityParam(e.target.value as keyof TaskDistribution)}
                  className="text-xs p-2 rounded-lg font-medium cursor-pointer"
                  style={{ background: C.surface2, color: C.ink, border: `1px solid ${C.border}` }}
                >
                  {SENSITIVITY_PARAMS.map((sp) => (
                    <option key={sp.key} value={sp.key}>{sp.label}</option>
                  ))}
                </select>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={sensitivityData} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis
                    dataKey="paramValue"
                    tickFormatter={(v) => sensConfig.fmt(Number(v))}
                    label={{ value: sensConfig.label, position: "insideBottom", offset: -10, fontSize: 11 }}
                  />
                  <YAxis tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    formatter={(value) => [`${Number(value).toFixed(1)}%`, "Employment Change"]}
                    labelFormatter={(v) => `${sensConfig.label}: ${sensConfig.fmt(Number(v))}`}
                  />
                  <ReferenceLine y={0} stroke={C.borderStrong} strokeDasharray="6 3" strokeWidth={1} />
                  <ReferenceLine
                    x={effectiveParams[sensitivityParam]}
                    stroke={C.rust} strokeDasharray="4 4"
                    label={{ value: "Current", position: "top", fill: C.rust, fontSize: 11, fontWeight: 600 }}
                  />
                  <defs>
                    <linearGradient id="sensGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.navy} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={C.navy} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="pctChange" stroke={C.navy} strokeWidth={2} fill="url(#sensGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* Model explanation */}
            <Card>
              <SectionTitle>Model: Acemoglu-Restrepo Task Framework</SectionTitle>
              <div className="text-[13px] leading-relaxed space-y-3" style={{ color: C.inkSec }}>
                <p>
                  Jobs consist of a <strong style={{ color: C.ink }}>continuum of tasks</strong>. AI automates tasks from one end while
                  new human-requiring tasks emerge at the other. Employment depends on the <strong style={{ color: C.ink }}>race</strong> between three forces:
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl p-3.5 border" style={{ background: C.rustLight, borderColor: "#f0ddd6" }}>
                    <div className="font-semibold text-[12px]" style={{ color: C.rust }}>Displacement</div>
                    <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "#9a4a34" }}>AI takes over tasks previously done by humans</div>
                  </div>
                  <div className="rounded-xl p-3.5 border" style={{ background: C.sageLight, borderColor: "#d4e8dc" }}>
                    <div className="font-semibold text-[12px]" style={{ color: C.sage }}>New Tasks</div>
                    <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "#3a6b4d" }}>New tasks emerge requiring human skills</div>
                  </div>
                  <div className="rounded-xl p-3.5 border" style={{ background: C.navyLight, borderColor: "#d4dde8" }}>
                    <div className="font-semibold text-[12px]" style={{ color: C.navy }}>Demand (Jevons)</div>
                    <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "#3a5578" }}>Productivity gains expand total output demand</div>
                  </div>
                </div>
                <p className="pt-1 text-[11px]" style={{ color: C.inkTert }}>
                  <strong style={{ color: C.inkSec }}>Sources:</strong> Eloundou et al. (2023) for theoretical exposure.
                  Massenkoff & McCrory (2026) via Anthropic Economic Index for observed exposure.
                  BLS OES May 2021 for employment. BLS 2024–2034 projections for validation.
                </p>
              </div>
            </Card>

            {/* Tornado / Waterfall chart */}
            <Card>
              <SectionTitle sub={`How \u00B1 50% change in each parameter affects employment at year ${years}`}>
                Parameter Importance: {selectedGroup.name}
              </SectionTitle>
              <div style={{ height: Math.max(200, tornadoData.length * 44 + 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={tornadoData.map((d) => ({
                      label: d.label,
                      lowDelta: d.low - d.base,
                      highDelta: d.high - d.base,
                      low: d.low,
                      high: d.high,
                      base: d.base,
                    }))}
                    layout="vertical"
                    margin={{ top: 5, right: 60, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={C.border} />
                    <XAxis type="number" tickFormatter={(v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`} />
                    <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11 }} />
                    <Tooltip
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={((value: any, name: any) => [
                        `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(1)}%`,
                        name === "lowDelta" ? "Low (-50%)" : "High (+50%)",
                      ]) as any}
                    />
                    <ReferenceLine x={0} stroke={C.borderStrong} strokeWidth={1.5} />
                    <Bar dataKey="lowDelta" name="Low (-50%)" fill={C.rust} opacity={0.7} barSize={14} radius={[4, 0, 0, 4]} />
                    <Bar dataKey="highDelta" name="High (+50%)" fill={C.sage} opacity={0.7} barSize={14} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] mt-2" style={{ color: C.inkTert }}>
                Bars show change from baseline ({tornadoData[0]?.base.toFixed(1)}%) when each parameter is varied &plusmn;50%.
                Wider bars = more influential parameters. Demand elasticity is typically dominant.
              </p>
            </Card>

            {/* Limitations & Caveats */}
            <Card>
              <SectionTitle>Known Limitations</SectionTitle>
              <div className="text-[12px] leading-relaxed space-y-2" style={{ color: C.inkSec }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg p-3 border" style={{ background: C.surface2, borderColor: C.border }}>
                    <div className="font-semibold text-[11px] mb-1" style={{ color: C.ink }}>No wage effects</div>
                    <p className="text-[10px]">Employment changes assume elastic labor supply at constant wages. A wage model needs CES labor market structure with skill heterogeneity (cf. Katz &amp; Murphy, 1992).</p>
                  </div>
                  <div className="rounded-lg p-3 border" style={{ background: C.surface2, borderColor: C.border }}>
                    <div className="font-semibold text-[11px] mb-1" style={{ color: C.ink }}>Observed &ne; true automation</div>
                    <p className="text-[10px]">Massenkoff&apos;s observed exposure is an upper bound on I&#8320;. It includes augmentation (human+AI collaboration). True automation share is lower.</p>
                  </div>
                  <div className="rounded-lg p-3 border" style={{ background: C.surface2, borderColor: C.border }}>
                    <div className="font-semibold text-[11px] mb-1" style={{ color: C.ink }}>Demand elasticity ungrounded</div>
                    <p className="text-[10px]">Default &epsilon; values are heuristic, not calibrated. A&amp;R (2019) assume &epsilon;&asymp;1. Bessen (2019) range: 0.5&ndash;3+. Treat as assumed.</p>
                  </div>
                  <div className="rounded-lg p-3 border" style={{ background: C.surface2, borderColor: C.border }}>
                    <div className="font-semibold text-[11px] mb-1" style={{ color: C.ink }}>No cross-occupation dynamics</div>
                    <p className="text-[10px]">Each SOC group is modeled independently. In reality, displaced workers move across occupations, affecting wages and employment economy-wide.</p>
                  </div>
                </div>
                <div className="flex gap-3 mt-2">
                  <div className="flex items-center gap-1.5">
                    <ProvenanceBadge source="data" />
                    <span className="text-[9px]" style={{ color: C.inkTert }}>Empirical (BLS, Anthropic, Eloundou)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ProvenanceBadge source="derived" />
                    <span className="text-[9px]" style={{ color: C.inkTert }}>Formula from data</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ProvenanceBadge source="assumed" />
                    <span className="text-[9px]" style={{ color: C.inkTert }}>Heuristic &mdash; adjust with slider</span>
                  </div>
                </div>
              </div>
            </Card>

          </div>
        </div>
      </div>

      )}
    </div>
  );
}
