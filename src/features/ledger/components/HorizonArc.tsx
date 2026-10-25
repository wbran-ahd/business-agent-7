import { useEffect, useRef } from "react";

/** Draws the glowing horizon arc; reads the listening flag via an attribute. */
export function HorizonArc({ listening }: { listening: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const listeningRef = useRef(listening);
  // Kept out of render so the draw loop reads a committed value.
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let time = 0;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const active = listeningRef.current;
      const baseLine = canvas.height;
      const apexY = active ? baseLine - 90 - Math.sin(time * 2) * 15 : baseLine - 45;

      ctx.beginPath();
      ctx.moveTo(0, baseLine);
      ctx.quadraticCurveTo(canvas.width / 2, apexY, canvas.width, baseLine);

      const gradient = ctx.createLinearGradient(0, apexY, 0, baseLine);
      if (active) {
        gradient.addColorStop(0, "rgba(14, 165, 233, 0.8)");
        gradient.addColorStop(0.4, "rgba(14, 165, 233, 0.2)");
        gradient.addColorStop(1, "rgba(2, 132, 199, 0)");
      } else {
        gradient.addColorStop(0, "rgba(255, 255, 255, 0.3)");
        gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.05)");
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      }
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, baseLine);
      ctx.quadraticCurveTo(canvas.width / 2, apexY, canvas.width, baseLine);
      ctx.strokeStyle = active ? "rgba(186, 230, 253, 0.9)" : "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = active ? 3 : 1;
      ctx.stroke();

      if (active) time += 0.05;
      frame = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas id="horizon-canvas" ref={canvasRef} />;
}
