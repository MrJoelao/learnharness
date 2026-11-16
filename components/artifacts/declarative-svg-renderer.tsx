"use client";

import type {
	DeclarativeSvgDocument,
	DeclarativeSvgElement,
} from "@/src/core";

export interface DeclarativeSvgRendererProps {
	document: DeclarativeSvgDocument;
	currentStep: number;
	className?: string;
}

function formatPoints(points: string | [number, number][]): string {
	if (typeof points === "string") return points;
	if (Array.isArray(points)) {
		return points.map(([x, y]) => `${x},${y}`).join(" ");
	}
	return "";
}

function renderElement(el: DeclarativeSvgElement, key: number) {
	switch (el.type) {
		case "rect":
			return (
				<rect
					key={key}
					x={el.x}
					y={el.y}
					width={el.width}
					height={el.height}
					rx={el.rx}
					ry={el.ry}
					fill={el.fill ?? "none"}
					stroke={el.stroke}
					strokeWidth={el.strokeWidth}
					opacity={el.opacity}
				/>
			);
		case "circle":
			return (
				<circle
					key={key}
					cx={el.cx}
					cy={el.cy}
					r={el.r}
					fill={el.fill ?? "none"}
					stroke={el.stroke}
					strokeWidth={el.strokeWidth}
					opacity={el.opacity}
				/>
			);
		case "ellipse":
			return (
				<ellipse
					key={key}
					cx={el.cx}
					cy={el.cy}
					rx={el.rx}
					ry={el.ry}
					fill={el.fill ?? "none"}
					stroke={el.stroke}
					strokeWidth={el.strokeWidth}
					opacity={el.opacity}
				/>
			);
		case "line":
			return (
				<line
					key={key}
					x1={el.x1}
					y1={el.y1}
					x2={el.x2}
					y2={el.y2}
					stroke={el.stroke ?? "#000000"}
					strokeWidth={el.strokeWidth ?? 1}
					opacity={el.opacity}
				/>
			);
		case "polyline":
			return (
				<polyline
					key={key}
					points={formatPoints(el.points)}
					fill={el.fill ?? "none"}
					stroke={el.stroke ?? "#000000"}
					strokeWidth={el.strokeWidth ?? 1}
					opacity={el.opacity}
				/>
			);
		case "polygon":
			return (
				<polygon
					key={key}
					points={formatPoints(el.points)}
					fill={el.fill ?? "#cccccc"}
					stroke={el.stroke}
					strokeWidth={el.strokeWidth}
					opacity={el.opacity}
				/>
			);
		case "text":
			return (
				<text
					key={key}
					x={el.x}
					y={el.y}
					fontSize={el.fontSize ?? 14}
					fontFamily={el.fontFamily ?? "system-ui, sans-serif"}
					fontWeight={el.fontWeight}
					textAnchor={el.textAnchor ?? el.anchor ?? "start"}
					fill={el.fill ?? "#000000"}
					opacity={el.opacity}
				>
					{el.text}
				</text>
			);
		default:
			return null;
	}
}

/**
 * Pure declarative SVG renderer for LearnHarness Visual Explanation Engine.
 *
 * Maps validated JSON primitive structures into native React SVG elements.
 * Never uses dangerouslySetInnerHTML, innerHTML, eval, or runtime script execution.
 */
export function DeclarativeSvgRenderer({
	document,
	currentStep,
	className = "",
}: DeclarativeSvgRendererProps) {
	if (!document || !Array.isArray(document.steps) || document.steps.length === 0) {
		return (
			<svg
				viewBox="0 0 400 200"
				width="100%"
				height="auto"
				role="img"
				aria-label="Empty visualization"
				className={className}
				data-testid="declarative-svg-empty"
			>
				<text x="200" y="100" textAnchor="middle" fill="#6b7280" fontSize="13">
					No visualization elements available
				</text>
			</svg>
		);
	}

	const vb = document.viewBox || { x: 0, y: 0, width: 800, height: 450 };
	const viewBoxStr = `${vb.x ?? 0} ${vb.y ?? 0} ${vb.width} ${vb.height}`;
	const stepIndex = Math.max(0, Math.min(currentStep, document.steps.length - 1));
	const activeStep = document.steps[stepIndex];

	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox={viewBoxStr}
			width="100%"
			height="auto"
			role="img"
			aria-label={activeStep?.label ?? "Visual explanation"}
			className={className}
			data-testid="declarative-svg-root"
			data-step-index={stepIndex}
			data-step-id={activeStep?.id}
		>
			{activeStep?.description && (
				<desc>{activeStep.description}</desc>
			)}
			{activeStep?.elements.map((el, i) => renderElement(el, i))}
		</svg>
	);
}
