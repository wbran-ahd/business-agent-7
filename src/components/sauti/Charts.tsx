/**
 * Chart.js widgets for صوتی بقیہ analytics.
 *
 * Dark-theme styling matches the assistant panel: Nastaliq legend text,
 * translucent emerald / rose fills and a faint white grid. Every chart lives
 * in an explicitly sized wrapper so it never collapses to zero height.
 *
 * Audit 1.5.4 (SAU-302): `chart.js/auto` pulled in every controller and scale
 * (~210 kB chunk). The app only draws doughnut, line and bar — those exact
 * pieces are registered here instead, cutting the ChartsPanel chunk roughly in
 * half. Add entries to this registry if a new chart type joins the panel.
 */
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { useEffect, useRef } from "react";

Chart.register(
  // Controllers — one per chart type the panel draws.
  DoughnutController,
  LineController,
  BarController,
  // Elements referenced by those controllers.
  ArcElement,
  LineElement,
  PointElement,
  BarElement,
  // Scales & interaction plugins the options below rely on.
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
);

const NASTALIQ = "Noto Nastaliq Urdu";
const AXIS = "rgba(255, 255, 255, 0.6)";
const GRID = "rgba(255, 255, 255, 0.08)";

const legend = {
  labels: { color: "#ffffff", font: { family: NASTALIQ } },
};

const scales = {
  x: {
    ticks: { color: AXIS, font: { family: NASTALIQ } },
    grid: { color: GRID },
  },
  y: {
    ticks: { color: AXIS, font: { family: NASTALIQ } },
    grid: { color: GRID },
  },
};

function useChart(build: (ctx: CanvasRenderingContext2D) => Chart, deps: unknown[]) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const chart = build(ctx);
    return () => chart.destroy();
    // deps are provided by the caller; build is recreated each render anyway
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return canvasRef;
}

/** Original income vs expense doughnut — identical to the first release. */
export function MonthlyDoughnut({ income, expense }: { income: number; expense: number }) {
  const canvasRef = useChart(
    (ctx) =>
      new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: ["کل آمدنی", "کل خرچہ"],
          datasets: [
            {
              data: [income, expense],
              backgroundColor: ["rgba(52, 211, 153, 0.8)", "rgba(251, 113, 133, 0.8)"],
              borderColor: ["#34d399", "#fb7185"],
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend },
        },
      }),
    [income, expense],
  );

  return <canvas ref={canvasRef} height="200" />;
}

/** Last N months income vs expense. */
export function TrendLineChart({
  labels,
  income,
  expense,
}: {
  labels: string[];
  income: number[];
  expense: number[];
}) {
  const key = `${labels.join(",")}|${income.join(",")}|${expense.join(",")}`;
  const canvasRef = useChart(
    (ctx) =>
      new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "آمدنی",
              data: income,
              borderColor: "#38bdf8",
              backgroundColor: "rgba(56, 189, 248, 0.15)",
              tension: 0.35,
              fill: false,
              pointRadius: 3,
            },
            {
              label: "خرچہ",
              data: expense,
              borderColor: "#fb7185",
              backgroundColor: "rgba(251, 113, 133, 0.15)",
              tension: 0.35,
              fill: false,
              pointRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend },
          scales,
        },
      }),
    [key],
  );

  return (
    <div style={{ position: "relative", height: 180 }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

/** Where the money went, biggest category first. */
export function CategoryBarChart({
  labels,
  data,
}: {
  labels: string[];
  data: number[];
}) {
  const key = `${labels.join("|")}|${data.join(",")}`;
  const canvasRef = useChart(
    (ctx) =>
      new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "خرچہ",
              data,
              backgroundColor: "rgba(14, 165, 233, 0.55)",
              borderColor: "#38bdf8",
              borderWidth: 1,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales,
        },
      }),
    [key],
  );

  return (
    <div style={{ position: "relative", height: Math.max(120, labels.length * 40) }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
