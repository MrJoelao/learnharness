import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateVisualArtifact } from "../src/core/visual-explanation-validator.ts";

describe("Visual Explanation Security Validation — Adversarial Test Suite (Fix G)", () => {
	it("rejects non-allowlisted SVG elements (audio, video, canvas, input, button, form)", () => {
		const disallowedTags = [
			'<svg><audio src="sound.mp3"></audio></svg>',
			'<svg><video><source src="movie.mp4"/></video></svg>',
			'<svg><canvas id="c"></canvas></svg>',
			'<svg><input type="text"/></svg>',
			'<svg><button>Click me</button></svg>',
			'<svg><form action="https://evil.com"></form></svg>',
			'<svg><textarea></textarea></svg>',
			'<svg><select><option>1</option></select></svg>',
		];

		for (const source of disallowedTags) {
			const res = validateVisualArtifact({
				version: 1,
				id: "adv-tag",
				title: "Tag Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected ${source} to be rejected`);
			assert.ok(
				res.problems.some((p) => p.includes("forbidden tags") || p.includes("allowlist")),
				`Error message must mention forbidden tag for ${source}`,
			);
		}
	});

	it("rejects event handlers with any casing or whitespace (ONCLICK, onfocus, onanimationstart)", () => {
		const trickyHandlers = [
			'<svg ONCLICK="evil()"><rect width="10" height="10"/></svg>',
			'<svg><rect width="10" height="10" onfocus="leak()"/></svg>',
			'<svg><path d="M0,0" onanimationstart="alert(1)"/></svg>',
			'<svg><g onmouseover = "steal()"><circle r="5"/></g></svg>',
		];

		for (const source of trickyHandlers) {
			const res = validateVisualArtifact({
				version: 1,
				id: "adv-event",
				title: "Event Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected ${source} to be rejected`);
			assert.ok(
				res.problems.some((p) => p.includes("inline event handlers")),
				`Error message must flag inline event handler for ${source}`,
			);
		}
	});

	it("rejects unsafe protocol schemes in href, xlink:href, or attributes", () => {
		const unsafeProtocols = [
			'<svg><a href="javascript:alert(document.domain)"><text>Link</text></a></svg>',
			'<svg><a xlink:href="vbscript:msgbox(1)"><text>Link</text></a></svg>',
			'<svg><use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/></svg>',
		];

		for (const source of unsafeProtocols) {
			const res = validateVisualArtifact({
				version: 1,
				id: "adv-proto",
				title: "Protocol Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected ${source} to be rejected`);
			assert.ok(
				res.problems.some((p) => p.includes("unsafe protocol") || p.includes("forbidden")),
			);
		}
	});

	it("rejects external network URLs in SVG references", () => {
		const externalUrls = [
			'<svg><use href="https://evil.com/icon.svg#symbol"/></svg>',
			'<svg><use xlink:href="http://tracker.com/pixel.svg#p"/></svg>',
			'<svg><use href="//cdn.attacker.org/defs.svg"/></svg>',
			'<svg><use href="ftp://files.example.com/marker.svg"/></svg>',
		];

		for (const source of externalUrls) {
			const res = validateVisualArtifact({
				version: 1,
				id: "adv-ext",
				title: "External URL Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected ${source} to be rejected`);
			assert.ok(
				res.problems.some((p) => p.includes("external URLs")),
			);
		}
	});

	it("rejects unauthorized foreign XML namespaces in SVG", () => {
		const foreignNamespaces = [
			'<svg xmlns:html="http://www.w3.org/1999/xhtml"><html:div>Injected XHTML</html:div></svg>',
			'<svg xmlns:ev="http://www.w3.org/2001/xml-events"><rect width="10" height="10"/></svg>',
		];

		for (const source of foreignNamespaces) {
			const res = validateVisualArtifact({
				version: 1,
				id: "adv-ns",
				title: "Namespace Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected foreign namespace ${source} to be rejected`);
			assert.ok(
				res.problems.some((p) => p.includes("namespace") || p.includes("forbidden tags")),
			);
		}
	});

	it("rejects external DTD, ENTITY declarations and processing instructions", () => {
		const dtdSources = [
			'<!DOCTYPE svg SYSTEM "http://evil.com/dtd"><svg><rect width="10" height="10"/></svg>',
			'<!DOCTYPE svg [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><svg><text>&xxe;</text></svg>',
			'<?xml-stylesheet type="text/css" href="http://evil.com/style.css"?><svg><rect/></svg>',
			'<?php echo "evil"; ?><svg><rect/></svg>',
		];

		for (const source of dtdSources) {
			const res = validateVisualArtifact({
				version: 1,
				id: "adv-dtd",
				title: "DTD/PI Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected ${source} to be rejected`);
			assert.ok(
				res.problems.some((p) => p.includes("DTD") || p.includes("processing instructions")),
			);
		}
	});

	it("rejects dangerous CSS in <style> elements (@import, external url, dynamic expressions)", () => {
		const dangerousStyles = [
			'<svg><style>@import url("http://evil.com/leak.css");</style><rect/></svg>',
			'<svg><style>rect { fill: url(http://evil.com/tracker.png); }</style><rect/></svg>',
			'<svg><style>rect { width: expression(alert(1)); }</style><rect/></svg>',
			'<svg><style>body { -moz-binding: url(http://evil.com/xbl); }</style><rect/></svg>',
		];

		for (const source of dangerousStyles) {
			const res = validateVisualArtifact({
				version: 1,
				id: "adv-style",
				title: "Style Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected style block ${source} to be rejected`);
			assert.ok(
				res.problems.some((p) => p.includes("style blocks")),
			);
		}
	});

	it("rejects HTML artifacts attempting to access host environment or external scripts", () => {
		const hostileHtml = [
			'<div><script src="https://evil.com/tracker.js"></script></div>',
			'<script>window.parent.document.body.innerHTML = "pwnd";</script>',
			'<div><script>const fs = require("fs"); fs.readFileSync("/etc/passwd");</script></div>',
			'<div><script>const token = localStorage.getItem("token");</script></div>',
			'<div><script>const cookies = document.cookie;</script></div>',
			'<link rel="stylesheet" href="https://evil.com/style.css"><div>Text</div>',
			'<iframe src="https://attacker.org/embed"></iframe>',
			'<a href="javascript:alert(1)">Click</a>',
		];

		for (const source of hostileHtml) {
			const res = validateVisualArtifact({
				version: 1,
				id: "adv-html",
				title: "HTML Security Test",
				renderer: "html",
				source,
			});
			assert.equal(res.valid, false, `Expected hostile HTML to be rejected: ${source}`);
			assert.ok(res.problems.length > 0);
		}
	});
});
