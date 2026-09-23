"use client";

import { useEffect, useRef, useState } from "react";
import type { GraphEdge, GraphNode, Role } from "@/lib/data";

export type GraphPosition = { node: GraphNode; x: number; y: number };
const WIDTH = 1500;
const HEIGHT = 900;
const COLORS: Record<Role, string> = {
  coordinator: "#ff6438", consolidator: "#edc768", distributor: "#ae82f5",
  transit: "#79c9ca", terminal: "#84b3e8", peripheral: "#8d8b8a"
};
const NAMES: Record<Role, string> = {
  coordinator: "Кандидат на координацию", consolidator: "Консолидация", distributor: "Распределение",
  transit: "Возможный транзит", terminal: "Возможная точка остановки", peripheral: "Периферия"
};

export default function GraphCanvas({ positions, edges, selectedGid, mode, onSelect, onClear }: {
  positions: GraphPosition[]; edges: GraphEdge[]; selectedGid: string; mode: "overview" | "focus";
  onSelect: (gid: string) => void; onClear: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camera = useRef({ scale: 1, x: 0, y: 0 });
  const fitRef = useRef<() => void>(() => {});
  const zoomRef = useRef<(factor: number) => void>(() => {});
  const onSelectRef = useRef(onSelect);
  const onClearRef = useRef(onClear);
  onSelectRef.current = onSelect;
  onClearRef.current = onClear;
  const [hovered, setHovered] = useState<{ node: GraphNode; x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    const points = new Map(positions.map(position => [position.node.gid, position]));
    let frame = 0;
    let width = 1, height = 1;
    let drag: { x: number; y: number; offsetX: number; offsetY: number; moved: boolean } | null = null;
    let hoverGid = "";

    function fit() {
      const scale = Math.min(width / WIDTH, height / HEIGHT) * .94;
      camera.current = { scale, x: (width - WIDTH * scale) / 2, y: (height - HEIGHT * scale) / 2 };
      requestDraw();
    }
    function requestDraw() {
      if (!frame) frame = requestAnimationFrame(draw);
    }
    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
      fit();
    }
    function draw() {
      frame = 0;
      if (!context) return;
      context.save();
      context.fillStyle = "#191817";
      context.fillRect(0, 0, width, height);
      const { scale, x, y } = camera.current;
      context.translate(x, y);
      context.scale(scale, scale);
      if (mode === "overview") {
        context.strokeStyle = "rgba(255,255,255,.12)";
        context.fillStyle = "#a29b99";
        context.font = "16px sans-serif";
        context.textAlign = "center";
        for (let depth = 0; depth < 5; depth++) {
          const px = 85 + depth * 325;
          context.beginPath(); context.moveTo(px, 30); context.lineTo(px, HEIGHT - 20); context.stroke();
          context.fillText(depth === 0 ? "SEED" : `${depth} КОЛЕНО`, px, 20);
        }
      } else {
        context.fillStyle = "#a29b99"; context.font = "18px sans-serif";
        context.fillText("ОТ КОГО", 190, 34); context.fillText("КОМУ", 1120, 34);
      }
      context.lineWidth = Math.max(.8, 1 / scale);
      for (const edge of edges) {
        const source = points.get(edge.src), target = points.get(edge.dst);
        if (!source || !target) continue;
        const active = selectedGid === edge.src || selectedGid === edge.dst;
        context.strokeStyle = active ? "rgba(255,100,56,.70)" : "rgba(180,173,170,.12)";
        context.lineWidth = active ? 2.1 : .65;
        context.beginPath(); context.moveTo(source.x, source.y); context.lineTo(target.x, target.y); context.stroke();
        if (active) {
          const dx = target.x - source.x, dy = target.y - source.y;
          const angle = Math.atan2(dy, dx);
          const headX = target.x - Math.cos(angle) * 8, headY = target.y - Math.sin(angle) * 8;
          context.fillStyle = "#ff6438";
          context.beginPath(); context.moveTo(headX, headY);
          context.lineTo(headX - Math.cos(angle - .55) * 8, headY - Math.sin(angle - .55) * 8);
          context.lineTo(headX - Math.cos(angle + .55) * 8, headY - Math.sin(angle + .55) * 8);
          context.fill();
        }
      }
      for (const position of positions) {
        const node = position.node;
        const active = selectedGid === node.gid, hoveredNode = hoverGid === node.gid;
        const radius = active ? 10 : hoveredNode ? 8 : 2.8 + node.priority_score * 4;
        if (active || hoveredNode) {
          context.fillStyle = "rgba(255,100,56,.18)";
          context.beginPath(); context.arc(position.x, position.y, radius + 10, 0, Math.PI * 2); context.fill();
        }
        context.fillStyle = COLORS[node.role];
        context.beginPath(); context.arc(position.x, position.y, radius, 0, Math.PI * 2); context.fill();
        if (active || node.is_seed) {
          context.strokeStyle = active ? "#fff" : "rgba(255,255,255,.75)";
          context.lineWidth = active ? 2.2 : 1;
          context.stroke();
        }
      }
      if (mode === "focus") {
        const center = points.get(selectedGid);
        if (center) {
          context.textAlign = "center";
          context.font = "700 18px sans-serif";
          context.fillStyle = "#f6f2ef";
          context.fillText("ВЫБРАННЫЙ СЧЁТ", center.x, center.y - 28);
          context.font = "14px sans-serif";
          context.fillStyle = "#b9afaa";
          context.fillText(selectedGid, center.x, center.y + 30);
        }
      }
      context.restore();
    }
    function locate(event: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      return { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
    }
    function hit(sx: number, sy: number) {
      const { scale, x, y } = camera.current;
      const wx = (sx - x) / scale, wy = (sy - y) / scale;
      let found: GraphPosition | null = null, best = (13 / scale) ** 2;
      for (const position of positions) {
        const distance = (position.x - wx) ** 2 + (position.y - wy) ** 2;
        if (distance < best) { best = distance; found = position; }
      }
      return found;
    }
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const sx = event.clientX - rect.left, sy = event.clientY - rect.top;
      const current = camera.current, next = Math.max(.2, Math.min(5, current.scale * (event.deltaY < 0 ? 1.13 : .885)));
      const wx = (sx - current.x) / current.scale, wy = (sy - current.y) / current.scale;
      camera.current = { scale: next, x: sx - wx * next, y: sy - wy * next };
      requestDraw();
    }
    function pointerDown(event: PointerEvent) {
      const { sx, sy } = locate(event);
      drag = { x: sx, y: sy, offsetX: camera.current.x, offsetY: camera.current.y, moved: false };
      canvas!.setPointerCapture(event.pointerId);
    }
    function pointerMove(event: PointerEvent) {
      const { sx, sy } = locate(event);
      if (drag) {
        const dx = sx - drag.x, dy = sy - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) { camera.current.x = drag.offsetX + dx; camera.current.y = drag.offsetY + dy; requestDraw(); }
        return;
      }
      const found = hit(sx, sy);
      canvas!.style.cursor = found ? "pointer" : "grab";
      if ((found?.node.gid || "") !== hoverGid) {
        hoverGid = found?.node.gid || "";
        setHovered(found ? { node: found.node, x: sx, y: sy } : null);
        requestDraw();
      } else if (found) setHovered({ node: found.node, x: sx, y: sy });
    }
    function pointerUp(event: PointerEvent) {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (canvas!.hasPointerCapture(event.pointerId)) canvas!.releasePointerCapture(event.pointerId);
      if (!moved) {
        const { sx, sy } = locate(event);
        const found = hit(sx, sy);
        if (found) onSelectRef.current(found.node.gid); else onClearRef.current();
      }
    }
    function pointerLeave() { if (!drag) { hoverGid = ""; setHovered(null); requestDraw(); } }
    function zoomButton(factor: number) {
      const current = camera.current, next = Math.max(.2, Math.min(5, current.scale * factor));
      const wx = (width / 2 - current.x) / current.scale, wy = (height / 2 - current.y) / current.scale;
      camera.current = { scale: next, x: width / 2 - wx * next, y: height / 2 - wy * next };
      requestDraw();
    }
    fitRef.current = fit; zoomRef.current = zoomButton;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointerleave", pointerLeave);
    resize();
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointerleave", pointerLeave);
    };
  }, [positions, edges, selectedGid, mode]);

  return <div className="network-canvas-wrap"><div className="graph-camera-controls"><button type="button" onClick={() => zoomRef.current(1.3)} aria-label="Приблизить граф">+</button><button type="button" onClick={() => zoomRef.current(1 / 1.3)} aria-label="Отдалить граф">−</button><button type="button" onClick={() => fitRef.current()}>Весь граф</button></div>
    <canvas ref={canvasRef} aria-label="Интерактивный граф: колесо мыши — масштаб, перетаскивание — перемещение, нажатие на узел — карточка. Поиск GID доступен над графом." role="img"/>
    {hovered && <div className="graph-tooltip" style={{ left: Math.min(hovered.x + 14, Math.max(12, (canvasRef.current?.clientWidth || 790) - 260)), top: Math.max(8, hovered.y - 70) }}><strong>{hovered.node.gid}</strong><span>{NAMES[hovered.node.role]} · приоритет {Math.round(hovered.node.priority_score * 100)}%</span><small>{hovered.node.in_deg} входящих · {hovered.node.out_deg} исходящих</small></div>}
  </div>;
}
