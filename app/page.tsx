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
  totalUSEmployment,
  type TaskDistribution,
  type GroupResult,
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
  label, value, onChange, min, max, step, suffix = "", helpText, tooltip,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; suffix?: string; helpText?: string; tooltip?: string;
}) {
  const decimals = step < 0.005 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return (
    <div className="mb-4">
      <div className="flex justify-between items-baseline mb-1">
        <div className="flex items-center">
          <label className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: C.inkSec }}>{label}</label>
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

function AdoptionBar({ observed, ceiling, gamma }: { observed: number; ceiling: number; gamma: number }) {
  const maxVal = Math.max(gamma, 1);
  return (
    <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: C.surface2 }}>
      <div className="absolute h-full rounded-full" style={{ width: `${(gamma / maxVal) * 100}%`, background: "rgba(196,77,43,0.15)" }} />
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
  ceilingMode: "alpha" | "beta" | "gamma";
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

    // Theoretical (navy dashed), Simulated (ochre), Observed (rust)
    drawPolygon(data.map((d) => d.theoretical), "rgba(43,76,126,0.06)", "rgba(43,76,126,0.45)", 1.5, true);
    drawPolygon(data.map((d) => d.simulated), "rgba(184,134,11,0.08)", "rgba(184,134,11,0.65)", 2);
    drawPolygon(data.map((d) => d.observed), "rgba(196,77,43,0.10)", "rgba(196,77,43,0.6)", 2);

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
          <svg width="16" height="3"><line x1="0" y1="1.5" x2="16" y2="1.5" stroke={C.navy} strokeWidth="2" strokeDasharray="4 2" /></svg>
          <span style={{ color: C.inkSec }}>Ceiling ({ceilingMode})</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: C.rust }} />
          <span style={{ color: C.inkSec }}>Observed</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: C.ochre }} />
          <span style={{ color: C.inkSec }}>Simulated (Yr {results[0]?.timeline.length - 1})</span>
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

function WhitePaper({ onSwitchToSim }: { onSwitchToSim: () => void }) {
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
            ["parameters", "Simulation Parameters Explained"],
            ["what-it-shows", "What the Simulation Shows"],
            ["limitations", "Limitations and Caveats"],
            ["references", "References"],
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
          <li><strong style={{ color: C.ink }}>&gamma; (gamma):</strong> Tasks automatable assuming all plausible AI-powered tools get built. The most aggressive estimate.</li>
        </ul>
        <p>
          The gap between current automation (Anthropic observed) and the theoretical ceiling (Eloundou &beta;) tells us how much <em>room</em> there is for further automation. Computer & Math occupations have a frontier at 35.8% with a &beta; ceiling of 63.4% &mdash; meaning roughly half the automatable tasks have already been adopted. Protective Service occupations sit at 2.9% with a ceiling of 25.9% &mdash; barely scratching the surface.
        </p>

        <H3>Employment: BLS Occupational Employment and Wage Statistics (2021)</H3>
        <p>
          The Bureau of Labor Statistics provides the baseline employment count for each SOC group. This lets us translate percentage changes into actual job numbers. Office & Administrative occupations are the largest group at 18.3 million workers; Agriculture is the smallest at 452,000.
        </p>

        {/* 6. Parameters */}
        <H2 id="parameters">Simulation Parameters Explained</H2>

        <p>
          The simulation has seven adjustable parameters for each occupation group. Here&rsquo;s what each one means and why it matters:
        </p>

        <ParamBox
          name="Current Automation"
          range="0 \u2013 80%"
          description="The fraction of tasks where AI is currently deployed, from Anthropic's observed data. This is where the automation frontier starts. Higher values mean the occupation is already heavily AI-augmented, leaving less room for further disruption (but also a higher baseline of AI-driven productivity)."
        />

        <ParamBox
          name="Theoretical Ceiling"
          range="0 \u2013 100%"
          description="The maximum fraction of tasks that could be automated given current or near-term AI capabilities. From Eloundou et al.'s estimates. The automation frontier cannot exceed this ceiling (until the ceiling itself grows). Switching between \u03B1, \u03B2, and \u03B3 scenarios dramatically changes the outlook."
        />

        <ParamBox
          name="Adoption Speed"
          range="0 \u2013 40%/yr"
          description="How fast automation actually happens. Each year, this fraction of the remaining gap between the current frontier and the ceiling gets closed. At 10%, if there's a 30-point gap, about 3 more percentage points of tasks get automated that year. This creates an S-curve: fast adoption when the gap is large, slowing as it approaches the ceiling. Think of it as organizational adoption friction \u2014 even when the technology is ready, deployment takes time."
        />

        <ParamBox
          name="Ceiling Growth"
          range="0 \u2013 10%/yr"
          description="How fast AI capabilities improve, pushing the theoretical ceiling higher. Applied to the remaining non-automatable fraction. Set this to 0 to model a world where AI capabilities plateau at today's level. Set it higher to model continued rapid capability growth. Knowledge work ceilings tend to expand faster as AI reasoning and tool use improve."
        />

        <ParamBox
          name="New Task Rate"
          range="0 \u2013 10%/yr"
          description="The annual rate at which new, human-requiring tasks are created as a fraction of total tasks. This is Acemoglu & Restrepo's 'reinstatement' force \u2014 the primary counterweight to displacement. Higher in knowledge work where AI creates entirely new categories of work (prompt engineering, AI governance, human-AI teaming). If you set this to 0, you get the pure displacement scenario with no new tasks."
        />

        <ParamBox
          name="Productivity Growth"
          range="1.0 \u2013 1.5x/yr"
          description="How much more productive each human worker becomes annually on their remaining tasks, thanks to AI augmentation. A lawyer using AI for research is faster but still doing the task \u2014 that's productivity growth. This interacts with demand elasticity to determine the Jevons effect: higher productivity \u00D7 higher elasticity = more demand expansion = more employment."
        />

        <ParamBox
          name="Demand Elasticity"
          range="0.1 \u2013 4.0"
          description="The Jevons parameter. How much total output demand expands when productivity gains lower effective costs. Above 1.0, demand grows faster than productivity (Jevons wins, employment grows). Below 1.0, productivity outpaces demand (fewer workers needed). Knowledge work is typically elastic (>1): there's always more code to write, more analysis to do. Physical labor is typically inelastic (<1): you only need one lawn mowed."
        />

        <p className="pt-4">
          The simulation also applies these parameters at two levels: <strong style={{ color: C.ink }}>global overrides</strong> set a uniform value across all 22 groups (useful for scenario analysis like &ldquo;what if adoption is slow everywhere?&rdquo;), and <strong style={{ color: C.ink }}>per-group parameters</strong> let you fine-tune individual occupations. Per-group values always take precedence over global settings.
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
          <li><strong style={{ color: C.ink }}>The ceiling scenario matters enormously.</strong> Switching from &alpha; (LLM only) to &gamma; (full tools) can flip an occupation from net growth to net decline, because the theoretical headroom for automation roughly triples.</li>
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
        <H2 id="limitations">Limitations and Caveats</H2>

        <p>
          This model is a pedagogical tool, not a crystal ball. Several important limitations:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong style={{ color: C.ink }}>Parameters are uncertain.</strong> We have decent empirical data for current automation and theoretical ceilings, but adoption speeds, new task creation rates, and demand elasticities are calibrated estimates, not measured values. The sensitivity analysis helps you see how much these assumptions matter.</li>
          <li><strong style={{ color: C.ink }}>Occupations are not monolithic.</strong> Each SOC major group contains dozens of specific occupations with very different exposure profiles. &ldquo;Computer & Math&rdquo; includes both software developers (highly exposed) and actuaries (moderately exposed). The model operates at the aggregate level.</li>
          <li><strong style={{ color: C.ink }}>No cross-occupation dynamics.</strong> In reality, workers displaced from one occupation may move to another, affecting wages and employment across the economy. This model treats each occupation independently.</li>
          <li><strong style={{ color: C.ink }}>No wage effects.</strong> The model only tracks employment quantity, not wages. Even in occupations where employment grows, wages could fall if the nature of remaining work changes (e.g., from high-skill to AI-supervision roles).</li>
          <li><strong style={{ color: C.ink }}>Linear assumptions in a nonlinear world.</strong> The model uses constant annual rates for adoption, new task creation, and productivity growth. In reality, these rates may accelerate, decelerate, or shift discontinuously as AI capabilities evolve.</li>
          <li><strong style={{ color: C.ink }}>No policy response.</strong> The model ignores government intervention &mdash; retraining programs, regulation, AI taxes, universal basic income &mdash; that could significantly alter outcomes.</li>
        </ul>

        <p>
          Despite these limitations, the model is valuable because it makes the <em>structure</em> of the argument explicit. The debate about AI and jobs often devolves into competing anecdotes. This framework forces you to specify your assumptions quantitatively and see their consequences &mdash; which is exactly what a good model should do.
        </p>

        {/* 9. References */}
        <H2 id="references">References</H2>

        <div className="space-y-3 text-[14px]" style={{ color: C.inkSec }}>
          <p>
            Acemoglu, D., & Restrepo, P. (2018). The Race between Man and Machine: Implications of Technology for Growth, Factor Shares, and Employment. <em>American Economic Review</em>, 108(6), 1488&ndash;1542.
          </p>
          <p>
            Acemoglu, D., & Restrepo, P. (2019). Automation and New Tasks: How Technology Displaces and Reinstates Labor. <em>Journal of Economic Perspectives</em>, 33(2), 3&ndash;30.
          </p>
          <p>
            Acemoglu, D., & Restrepo, P. (2018). Artificial Intelligence, Automation and Work. <em>NBER Working Paper 24196</em>. Published in <em>The Economics of Artificial Intelligence: An Agenda</em>, ed. Agarwal, Goldfarb, and Gans.
          </p>
          <p>
            Acemoglu, D., & Restrepo, P. (2022). Tasks, Automation, and the Rise in US Wage Inequality. <em>Econometrica</em>, 90(5), 1973&ndash;2016.
          </p>
          <p>
            Eloundou, T., Manning, S., Mishkin, P., & Rock, D. (2023). GPTs are GPTs: An Early Look at the Labor Market Impact Potential of Large Language Models. <em>arXiv:2303.10130</em>.
          </p>
          <p>
            Jevons, W. S. (1865). <em>The Coal Question: An Inquiry Concerning the Progress of the Nation, and the Probable Exhaustion of our Coal-Mines</em>. Macmillan.
          </p>
          <p>
            Massenkoff, M., & McCrory, P. (2026, March 5). Labor market impacts of AI: A new measure and early evidence. Anthropic. <a href="https://www.anthropic.com/research/labor-market-impacts" target="_blank" rel="noopener noreferrer" style={{ color: C.navy }}>https://www.anthropic.com/research/labor-market-impacts</a>
          </p>
          <p>
            U.S. Bureau of Labor Statistics. (2021). Occupational Employment and Wage Statistics (OEWS). May 2021 National Occupational Employment and Wage Estimates.
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
  const [activeTab, setActiveTab] = useState<"simulation" | "paper">("simulation");
  const [years, setYears] = useState(10);
  const [selectedSoc, setSelectedSoc] = useState("15");
  const [sensitivityParam, setSensitivityParam] = useState<keyof TaskDistribution>("adoptionSpeed");
  const [ceilingMode, setCeilingMode] = useState<"alpha" | "beta" | "gamma">("beta");

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
      const ceilOverride = ceilingMode !== "beta"
        ? { theoreticalCeiling: ceilingMode === "gamma" ? g.gamma : g.alpha }
        : {};
      adjusted[g.soc] = { ...globalOverrides, ...ceilOverride, ...overrides[g.soc] };
    }
    return adjusted;
  }, [overrides, globalOverrides, ceilingMode]);

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
    setCeilingMode("beta");
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
    ...(ceilingMode !== "beta" ? { theoreticalCeiling: ceilingMode === "gamma" ? selectedGroup.gamma : selectedGroup.alpha } : {}),
    ...overrides[selectedSoc],
  };

  const sensConfig = SENSITIVITY_PARAMS.find((p) => p.key === sensitivityParam)!;
  const sensitivityData = useMemo(() => {
    return sensitivitySweep(selectedGroup, effectiveOverrides[selectedSoc] || {}, sensitivityParam, sensConfig.range, years);
  }, [selectedGroup, effectiveOverrides, selectedSoc, sensitivityParam, sensConfig.range, years]);

  const totalFinal = results.reduce((s, r) => s + r.finalEmployment, 0);
  const totalPctChange = ((totalFinal / totalUSEmployment) - 1) * 100;

  const timelineData = selectedResult.timeline.map((yr) => ({
    year: yr.year,
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
            {([["simulation", "Simulation"], ["paper", "Guide & Methodology"]] as const).map(([key, label]) => (
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
        <WhitePaper onSwitchToSim={() => setActiveTab("simulation")} />
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
                min={0} max={20} step={1} suffix={years === 0 ? " (now)" : " yrs"}
                tooltip="How many years into the future to project. The model simulates year-by-year with compounding effects — adoption follows an S-curve, new tasks accumulate, and demand expands. Longer horizons amplify all three forces. At year 0, you see current state only."
              />

              <div className="mb-4">
                <div className="flex items-center mb-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.inkSec }}>Ceiling Scenario</label>
                  <TooltipInfo text="Which Eloundou et al. estimate to use as the automation ceiling. α = direct LLM only (most conservative). β = LLM + partial tools like code interpreters (default, most commonly cited). γ = all plausible AI tools built (most aggressive). Switching scenarios dramatically changes displacement headroom." />
                </div>
                <div className="flex gap-1.5">
                  {(["alpha", "beta", "gamma"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setCeilingMode(mode)}
                      className="flex-1 text-xs py-2 rounded-lg font-semibold transition-all duration-150"
                      style={ceilingMode === mode
                        ? { background: C.navy, color: "#fff", border: `1px solid ${C.navy}` }
                        : { background: C.surface2, color: C.inkSec, border: `1px solid ${C.border}` }
                      }
                    >
                      {mode === "alpha" ? "\u03B1 LLM" : mode === "beta" ? "\u03B2 Partial" : "\u03B3 Full"}
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
                <Slider
                  label="Ceiling Growth" value={globalOverrides.ceilingGrowthRate ?? 0.01}
                  onChange={(v) => updateGlobalParam("ceilingGrowthRate", v)}
                  min={0} max={0.1} step={0.005} suffix="/yr"
                  helpText={globalOverrides.ceilingGrowthRate !== undefined ? "Overriding all groups" : "Per-group defaults (0.5\u20132%/yr)"}
                  tooltip="How fast AI capabilities improve annually, pushing the theoretical ceiling higher. Applied to the remaining non-automatable fraction. At 0%, AI capabilities plateau at today's level. At 2–5%, the ceiling steadily rises, meaning new tasks become automatable over time. Drives displacement force."
                />
                <Slider
                  label="Adoption Speed" value={globalOverrides.adoptionSpeed ?? 0.08}
                  onChange={(v) => updateGlobalParam("adoptionSpeed", v)}
                  min={0} max={0.4} step={0.005} suffix="/yr"
                  helpText={globalOverrides.adoptionSpeed !== undefined ? "Overriding all groups" : "Per-group defaults (3\u201315%/yr)"}
                  tooltip="Fraction of the gap between current automation and ceiling closed each year. Creates an S-curve: fast early adoption that slows near the ceiling. At 5%, a 40-point gap narrows by 2 points/year initially. Higher values = faster displacement but also faster productivity gains. Drives displacement and demand forces."
                />
                <Slider
                  label="New Task Rate" value={globalOverrides.newTaskRate ?? 0.015}
                  onChange={(v) => updateGlobalParam("newTaskRate", v)}
                  min={0} max={0.1} step={0.005} suffix="/yr"
                  helpText={globalOverrides.newTaskRate !== undefined ? "Overriding all groups" : "Per-group defaults (0.1\u20132%/yr)"}
                  tooltip="Annual rate of new human-requiring tasks as a fraction of total tasks. This is Acemoglu & Restrepo's 'reinstatement' — the primary counterweight to displacement. At 0%, no new tasks emerge (pure displacement). At 2–3%, new task creation can partially or fully offset automation. Drives reinstatement force."
                />
                <Slider
                  label="Demand Elasticity" value={globalOverrides.demandElasticity ?? 1.0}
                  onChange={(v) => updateGlobalParam("demandElasticity", v)}
                  min={0.1} max={4} step={0.1}
                  helpText={globalOverrides.demandElasticity !== undefined ? "Overriding all groups" : "Per-group defaults (0.7\u20132.0)"}
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

              {/* Summary stats */}
              <div className="space-y-2.5 mt-5">
                <StatCard
                  label="All Occupations"
                  value={fmt(totalPctChange)}
                  positive={totalPctChange >= 0}
                  sub={`${fmtEmp(totalUSEmployment)} \u2192 ${fmtEmp(totalFinal)}`}
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <StatCard label="Knowledge" value={fmt(knowledgePct)} positive={knowledgePct >= 0} />
                  <StatCard label="Other" value={fmt(otherPct)} positive={otherPct >= 0} />
                </div>
              </div>
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
                  { label: "Observed (Anthropic)", value: `${(selectedGroup.observed * 100).toFixed(1)}%` },
                  { label: `Theoretical ${ceilingMode}`, value: `${(effectiveParams.theoreticalCeiling * 100).toFixed(1)}%` },
                  { label: "Theoretical \u03B3", value: `${(selectedGroup.gamma * 100).toFixed(1)}%` },
                  { label: "Adoption ratio", value: `${selectedGroup.beta > 0 ? ((selectedGroup.observed / selectedGroup.beta) * 100).toFixed(0) : 0}%` },
                  { label: "Employment", value: fmtEmp(selectedGroup.employment) },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between text-[10px]">
                    <span style={{ color: C.inkTert }}>{row.label}</span>
                    <span className="font-mono font-semibold" style={{ color: C.ink }}>{row.value}</span>
                  </div>
                ))}
                <AdoptionBar observed={selectedGroup.observed} ceiling={effectiveParams.theoreticalCeiling} gamma={selectedGroup.gamma} />
                <div className="flex justify-between text-[9px] font-medium">
                  <span style={{ color: C.navy }}>Observed</span>
                  <span style={{ color: C.inkTert }}>Ceiling</span>
                  <span style={{ color: C.rust }}>&gamma; max</span>
                </div>
              </div>

              <Slider
                label="Current Automation" value={effectiveParams.currentAutomation}
                onChange={(v) => updateParam(selectedSoc, "currentAutomation", v)}
                min={0} max={0.8} step={0.005}
                helpText="Fraction of tasks where AI is deployed today"
                tooltip="Starting point of the automation frontier — the fraction of tasks where AI is actually deployed today, from Anthropic's observed usage data. Higher values mean less room for further displacement but higher baseline AI-driven productivity. This is empirical data, not an estimate."
              />
              <Slider
                label="Theoretical Ceiling" value={effectiveParams.theoreticalCeiling}
                onChange={(v) => updateParam(selectedSoc, "theoreticalCeiling", v)}
                min={0} max={1} step={0.01}
                helpText="Max automatable fraction from Eloundou et al."
                tooltip="Maximum fraction of tasks that could be automated given current/near-term AI. From Eloundou et al. estimates. The automation frontier cannot exceed this value (until the ceiling itself grows via Ceiling Growth). The gap between Current Automation and this ceiling determines how much displacement headroom remains."
              />
              <Slider
                label="Adoption Speed" value={effectiveParams.adoptionSpeed}
                onChange={(v) => updateParam(selectedSoc, "adoptionSpeed", v)}
                min={0} max={0.4} step={0.005} suffix="/yr"
                helpText="Fraction of remaining gap closed per year (S-curve)"
                tooltip="Fraction of remaining automation gap closed annually. Creates S-curve dynamics — fast early adoption slowing near the ceiling. Default varies by sector: knowledge work ~12%, service ~8%, manual ~5%, adjusted by current adoption momentum. Drives displacement and demand forces."
              />
              <Slider
                label="Ceiling Growth" value={effectiveParams.ceilingGrowthRate}
                onChange={(v) => updateParam(selectedSoc, "ceilingGrowthRate", v)}
                min={0} max={0.1} step={0.005} suffix="/yr"
                helpText="Annual ceiling expansion as AI capabilities improve"
                tooltip="Annual expansion of the theoretical ceiling as AI capabilities improve. Default: knowledge work 2%/yr, service 1%/yr, manual 0.5%/yr. Higher values mean more tasks become automatable over time. Drives the displacement force."
              />
              <Slider
                label="New Task Rate" value={effectiveParams.newTaskRate}
                onChange={(v) => updateParam(selectedSoc, "newTaskRate", v)}
                min={0} max={0.1} step={0.005} suffix="/yr"
                helpText="Reinstatement: new human tasks created per year"
                tooltip="Annual new task creation rate — Acemoglu & Restrepo's 'reinstatement' effect. Default: knowledge 1–3%/yr scaled by exposure level, service 0.5–1.5%/yr, manual 0.1–0.5%/yr. The primary counterweight to displacement. Drives reinstatement force."
              />
              <Slider
                label="Productivity Growth" value={effectiveParams.humanProductivityGrowth}
                onChange={(v) => updateParam(selectedSoc, "humanProductivityGrowth", v)}
                min={1.0} max={1.5} step={0.01} suffix="x/yr"
                helpText="Annual productivity multiplier on human tasks"
                tooltip="Annual multiplier on human worker productivity for remaining (non-automated) tasks. A lawyer using AI for research is faster — that's productivity growth. At 1.0x, no AI-driven gain. At 1.10x, humans are 10% more productive per year. Interacts with demand elasticity for the Jevons effect: higher productivity × higher elasticity = more demand expansion."
              />
              <Slider
                label="Demand Elasticity" value={effectiveParams.demandElasticity}
                onChange={(v) => updateParam(selectedSoc, "demandElasticity", v)}
                min={0.1} max={4} step={0.1}
                helpText="Jevons paradox: >1 elastic, <1 inelastic"
                tooltip="The Jevons parameter — how much output demand expands when productivity lowers costs. >1 (elastic): demand grows faster than productivity, employment rises despite automation. =1: balanced. <1 (inelastic): fewer workers needed. Default varies by sector: knowledge work 1.4–2.2, service 0.7–1.5, manual 0.3–0.6."
              />
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

            {/* Bar chart */}
            <Card>
              <SectionTitle sub={`Ceiling: ${ceilingMode === "alpha" ? "\u03B1 (direct LLM only)" : ceilingMode === "beta" ? "\u03B2 (partial tools)" : "\u03B3 (full tools)"} \u00B7 Click bars to select`}>
                Employment Change at Year {years}
              </SectionTitle>
              <ResponsiveContainer width="100%" height={600}>
                <BarChart
                  data={sortedResults.map((r) => ({
                    name: r.name,
                    soc: r.soc,
                    pctChange: r.finalPctChange,
                    emp: r.baselineEmployment,
                  }))}
                  layout="vertical"
                  margin={{ top: 5, right: 80, left: 10, bottom: 5 }}
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
                    formatter={(value, _name, props) => [
                      `${Number(value).toFixed(1)}% (${fmtEmp(props.payload.emp)} workers)`,
                      "Employment Change",
                    ]}
                  />
                  <ReferenceLine x={0} stroke={C.borderStrong} strokeWidth={1.5} />
                  <Bar dataKey="pctChange" radius={[0, 4, 4, 0]} barSize={18} cursor="pointer">
                    {sortedResults.map((r, i) => (
                      <Cell
                        key={i}
                        fill={r.finalPctChange >= 0 ? C.sage : C.rust}
                        opacity={r.soc === selectedSoc ? 1 : 0.6}
                        stroke={r.soc === selectedSoc ? C.navy : "none"}
                        strokeWidth={r.soc === selectedSoc ? 2 : 0}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
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
                <SectionTitle>Summary at Year {years}</SectionTitle>
                <div className="overflow-y-auto max-h-[340px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0" style={{ background: C.surface1 }}>
                      <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                        <th className="text-left py-2 pr-1 font-semibold text-[10px] uppercase tracking-wide" style={{ color: C.inkTert }}>Group</th>
                        <th className="text-right py-2 px-1 font-semibold text-[10px] uppercase tracking-wide" style={{ color: C.inkTert }}>Obs</th>
                        <th className="text-right py-2 px-1 font-semibold text-[10px] uppercase tracking-wide" style={{ color: C.inkTert }}>Ceil</th>
                        <th className="text-right py-2 px-1 font-semibold text-[10px] uppercase tracking-wide" style={{ color: C.inkTert }}>Emp</th>
                        <th className="text-right py-2 pl-1 font-semibold text-[10px] uppercase tracking-wide" style={{ color: C.inkTert }}>Chg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedResults.map((r) => {
                        const g = socGroups.find((g) => g.soc === r.soc)!;
                        const ceil = ceilingMode === "gamma" ? g.gamma : ceilingMode === "alpha" ? g.alpha : g.beta;
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
                        <td className="py-2 pl-1 text-right font-mono" style={{ color: totalPctChange >= 0 ? C.sage : C.rust }}>
                          {fmt(totalPctChange)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] mt-2" style={{ color: C.inkTert }}>
                  Obs = observed. Ceil = ceiling ({ceilingMode}). Click to select.
                </p>
              </Card>
            </div>

            {/* Sensitivity analysis */}
            <Card>
              <div className="flex justify-between items-start mb-4">
                <SectionTitle sub={`Employment change at year ${years} as one parameter varies`}>
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
                  BLS OES May 2021 for employment.
                </p>
              </div>
            </Card>

          </div>
        </div>
      </div>

      )}
    </div>
  );
}
