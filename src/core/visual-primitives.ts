/**
 * Visual Explanation Engine — Declarative Educational Primitives (Phase 6)
 *
 * Provides deterministic, accessible, responsive SVG generators for common
 * computer science learning structures:
 * - Memory layout (pages, frames, address translation)
 * - CPU & registers (PC, SP, general purpose registers)
 * - Stack and heap
 * - Process scheduling & timelines
 * - Graph / tree nodes and edges
 * - Network nodes and packet flow
 */

export interface MemoryBlock {
	address: string;
	label: string;
	value?: string;
	highlight?: boolean;
	status?: "free" | "allocated" | "reserved" | "active";
}

export interface RegisterItem {
	name: string;
	value: string;
	highlight?: boolean;
}

export interface ProcessTimelineItem {
	pid: string;
	name: string;
	start: number;
	duration: number;
	state: "running" | "ready" | "waiting" | "terminated";
}

export interface GraphNodeItem {
	id: string;
	label: string;
	x: number;
	y: number;
	highlight?: boolean;
}

export interface GraphEdgeItem {
	from: string;
	to: string;
	label?: string;
	highlight?: boolean;
}

export interface PacketFlowItem {
	source: string;
	destination: string;
	packet: string;
	protocol?: string;
	step?: number;
}

/**
 * Generates an SVG representation of memory blocks / paging table.
 */
export function renderMemoryBlocksSvg(options: {
	title?: string;
	blocks: MemoryBlock[];
	width?: number;
	activeStep?: number;
}): string {
	const width = options.width ?? 500;
	const blockHeight = 36;
	const startY = 40;
	const height = startY + options.blocks.length * (blockHeight + 6) + 20;

	const blocksSvg = options.blocks
		.map((b, i) => {
			const y = startY + i * (blockHeight + 6);
			const isHighlighted = b.highlight ?? (options.activeStep !== undefined && options.activeStep === i);
			const fill = isHighlighted ? "#dbeafe" : b.status === "allocated" ? "#fef3c7" : "#f3f4f6";
			const stroke = isHighlighted ? "#2563eb" : "#9ca3af";
			const strokeWidth = isHighlighted ? "2" : "1";

			return `
        <g data-step="${i}" class="memory-block ${isHighlighted ? "active" : ""}">
          <text x="16" y="${y + 22}" font-family="monospace" font-size="12" fill="#6b7280">${escapeXml(b.address)}</text>
          <rect x="90" y="${y}" width="${width - 110}" height="${blockHeight}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
          <text x="105" y="${y + 22}" font-family="system-ui, sans-serif" font-size="13" font-weight="500" fill="#1f2937">${escapeXml(b.label)}</text>
          ${b.value ? `<text x="${width - 35}" y="${y + 22}" font-family="monospace" font-size="12" text-anchor="end" fill="#4b5563">${escapeXml(b.value)}</text>` : ""}
        </g>
      `;
		})
		.join("\n");

	return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" role="img" aria-label="${escapeXml(options.title ?? "Memory Layout")}">
      <title>${escapeXml(options.title ?? "Memory Layout")}</title>
      <rect width="100%" height="100%" fill="#ffffff" rx="8"/>
      ${options.title ? `<text x="16" y="24" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#111827">${escapeXml(options.title)}</text>` : ""}
      ${blocksSvg}
    </svg>
  `.trim();
}

/**
 * Generates an SVG representation of CPU registers and stack.
 */
export function renderCpuRegistersSvg(options: {
	title?: string;
	registers: RegisterItem[];
	stack?: string[];
	width?: number;
}): string {
	const width = options.width ?? 520;
	const regColWidth = 220;
	const height = 40 + Math.max(options.registers.length, options.stack?.length ?? 0) * 36 + 30;

	const registersSvg = options.registers
		.map((r, i) => {
			const y = 50 + i * 36;
			const fill = r.highlight ? "#dbeafe" : "#f9fafb";
			const stroke = r.highlight ? "#2563eb" : "#d1d5db";
			return `
        <g class="cpu-register">
          <text x="20" y="${y + 18}" font-family="monospace" font-size="13" font-weight="600" fill="#374151">${escapeXml(r.name)}</text>
          <rect x="70" y="${y}" width="140" height="26" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
          <text x="140" y="${y + 18}" font-family="monospace" font-size="12" text-anchor="middle" fill="#111827">${escapeXml(r.value)}</text>
        </g>
      `;
		})
		.join("\n");

	const stackSvg = (options.stack ?? [])
		.map((item, i) => {
			const y = 50 + i * 36;
			return `
        <g class="stack-frame">
          <rect x="${regColWidth + 50}" y="${y}" width="200" height="26" rx="4" fill="#ede9fe" stroke="#8b5cf6" stroke-width="1.5"/>
          <text x="${regColWidth + 150}" y="${y + 18}" font-family="monospace" font-size="12" text-anchor="middle" fill="#4c1d95">${escapeXml(item)}</text>
        </g>
      `;
		})
		.join("\n");

	return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" role="img" aria-label="${escapeXml(options.title ?? "CPU Registers and Stack")}">
      <title>${escapeXml(options.title ?? "CPU Registers and Stack")}</title>
      <rect width="100%" height="100%" fill="#ffffff" rx="8"/>
      <text x="20" y="28" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#111827">Registers</text>
      ${options.stack ? `<text x="${regColWidth + 50}" y="28" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#111827">Stack</text>` : ""}
      ${registersSvg}
      ${stackSvg}
    </svg>
  `.trim();
}

/**
 * Generates an SVG representation of process scheduling timeline (Gantt chart).
 */
export function renderProcessTimelineSvg(options: {
	title?: string;
	processes: ProcessTimelineItem[];
	totalTime?: number;
	width?: number;
}): string {
	const width = options.width ?? 540;
	const height = 180;
	const chartX = 50;
	const chartY = 50;
	const chartWidth = width - 80;
	const chartHeight = 80;

	const maxTime = options.totalTime ?? Math.max(...options.processes.map((p) => p.start + p.duration), 10);
	const timeScale = chartWidth / maxTime;

	const colors = {
		running: { fill: "#bbf7d0", stroke: "#16a34a" },
		ready: { fill: "#fef08a", stroke: "#ca8a04" },
		waiting: { fill: "#fed7aa", stroke: "#ea580c" },
		terminated: { fill: "#e5e7eb", stroke: "#6b7280" },
	};

	const itemsSvg = options.processes
		.map((p) => {
			const x = chartX + p.start * timeScale;
			const w = Math.max(p.duration * timeScale, 2);
			const color = colors[p.state] ?? colors.ready;

			return `
        <g class="process-slice" data-pid="${escapeXml(p.pid)}">
          <rect x="${x}" y="${chartY}" width="${w}" height="${chartHeight}" fill="${color.fill}" stroke="${color.stroke}" stroke-width="1.5"/>
          <text x="${x + w / 2}" y="${chartY + chartHeight / 2 + 5}" font-family="system-ui, sans-serif" font-size="11" font-weight="600" text-anchor="middle" fill="#1f2937">${escapeXml(p.name)}</text>
        </g>
      `;
		})
		.join("\n");

	// Time markers
	const markers: string[] = [];
	const step = Math.ceil(maxTime / 5);
	for (let t = 0; t <= maxTime; t += step) {
		const x = chartX + t * timeScale;
		markers.push(`
      <line x1="${x}" y1="${chartY + chartHeight}" x2="${x}" y2="${chartY + chartHeight + 6}" stroke="#9ca3af" stroke-width="1"/>
      <text x="${x}" y="${chartY + chartHeight + 20}" font-family="monospace" font-size="11" text-anchor="middle" fill="#6b7280">${t}</text>
    `);
	}

	return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" role="img" aria-label="${escapeXml(options.title ?? "Process Scheduling Timeline")}">
      <title>${escapeXml(options.title ?? "Process Scheduling Timeline")}</title>
      <rect width="100%" height="100%" fill="#ffffff" rx="8"/>
      <text x="20" y="28" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#111827">${escapeXml(options.title ?? "Process Timeline")}</text>
      ${itemsSvg}
      ${markers.join("\n")}
    </svg>
  `.trim();
}

function escapeXml(unsafe: string): string {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
