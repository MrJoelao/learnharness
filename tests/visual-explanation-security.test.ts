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

	it("rejects external network URLs and non-fragment schemes in SVG references", () => {
		const externalUrls = [
			'<svg><use href="https://evil.com/icon.svg#symbol"/></svg>',
			'<svg><use xlink:href="http://tracker.com/pixel.svg#p"/></svg>',
			'<svg><use href="//cdn.attacker.org/defs.svg"/></svg>',
			'<svg><use href="ftp://files.example.com/marker.svg"/></svg>',
			'<svg><use href="file:///etc/passwd"/></svg>',
			'<svg><use href="/absolute/path/file.svg#id"/></svg>',
			'<svg><use href="relative/file.svg#id"/></svg>',
			'<svg><rect fill="url(file:///etc/passwd)"/></svg>',
			'<svg><circle clip-path="url(ftp://files.example.com/clip)"/></svg>',
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
				res.problems.some((p) => p.includes("external URLs") || p.includes("non-fragment")),
				`Must report external or non-fragment URL violation for ${source}`,
			);
		}
	});

	it("rejects file: scheme in image tag and flags both disallowed tag and non-fragment URL (Phase 6.3)", () => {
		const source = '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>';
		const res = validateVisualArtifact({
			version: 1,
			id: "adv-file-image",
			title: "File Image Test",
			renderer: "svg",
			source,
		});
		assert.equal(res.valid, false, "Must reject image with file:///etc/passwd");
		assert.ok(
			res.problems.some((p) => p.includes("forbidden tags") && p.includes("image")),
			"Must flag disallowed <image> tag",
		);
		assert.ok(
			res.problems.some((p) => p.includes("external URLs") || p.includes("non-fragment")),
			"Must flag non-fragment / external URL in href",
		);
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

	it("rejects dangerous CSS in <style> elements (@import, external url, dynamic expressions, file/ftp schemes)", () => {
		const dangerousStyles = [
			'<svg><style>@import url("http://evil.com/leak.css");</style><rect/></svg>',
			'<svg><style>rect { fill: url(http://evil.com/tracker.png); }</style><rect/></svg>',
			'<svg><style>rect { fill: url(file:///etc/passwd); }</style><rect/></svg>',
			'<svg><style>rect { fill: url("ftp://evil.com/leak.png"); }</style><rect/></svg>',
			'<svg><style>rect { fill: url("blob:https://evil.com/uuid"); }</style><rect/></svg>',
			'<svg><style>rect { fill: url(/local/file.png); }</style><rect/></svg>',
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

	it("strictly rejects malformed XML structures (multiple roots, unclosed tags, unquoted attributes, undeclared prefix) (Fix A)", () => {
		const malformedXmlCases = [
			{ name: "multiple roots", source: '<svg><rect/></svg><svg><circle/></svg>' },
			{ name: "unclosed tag", source: '<svg><rect width="10" height="10"></svg>' },
			{ name: "mismatched closing tag", source: '<svg><g></rect></svg>' },
			{ name: "unquoted attribute value", source: '<svg><rect width=10 height="10"/></svg>' },
			{ name: "undeclared namespace prefix", source: '<svg><undeclared:circle r="5"/></svg>' },
			{ name: "root element is not svg", source: '<xml><svg><rect/></svg></xml>' },
		];

		for (const { name, source } of malformedXmlCases) {
			const res = validateVisualArtifact({
				version: 1,
				id: "xml-malformed",
				title: "XML Malformed Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected ${name} to be rejected fail-closed`);
			assert.ok(res.problems.length > 0, `Problems array must not be empty for ${name}`);
		}
	});

	it("rejects dangerous CSS in style attributes on elements (Fix B)", () => {
		const dangerousStyleAttributes = [
			'<svg><rect style="fill: url(https://evil.com/leak.png);"/></svg>',
			'<svg><circle style="fill: url(data:image/svg+xml,...);"/></svg>',
			'<svg><rect style="fill: url(file:///etc/passwd);"/></svg>',
			'<svg><rect style="fill: url(ftp://evil.com/marker);"/></svg>',
			'<svg><rect style="fill: url(/local/image.png);"/></svg>',
			'<svg><path style="width: expression(alert(1));"/></svg>',
			'<svg><g style="-moz-binding: url(http://evil.com/xbl);"><rect/></g></svg>',
			'<svg><rect style="behavior: url(default.htc);"/></svg>',
			'<svg><text style="fill: \\75rl(https://evil.com);">Text</text></svg>',
			'<svg><rect style="/* comment */ width: \\65xpression(1);"/></svg>',
		];

		for (const source of dangerousStyleAttributes) {
			const res = validateVisualArtifact({
				version: 1,
				id: "adv-style-attr",
				title: "Style Attribute Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected dangerous style attribute in ${source} to be rejected`);
			assert.ok(
				res.problems.some((p) => p.includes("style attribute") || p.includes("style blocks") || p.includes("external URLs")),
				`Must report CSS style violation for ${source}`,
			);
		}
	});

	it("accepts valid educational SVGs with defs, linearGradient, clipPath, mask, use with local #id, text and tspan (Fix A)", () => {
		const validComplexSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:rgb(255,255,0);stop-opacity:1" />
      <stop offset="100%" style="stop-color:rgb(255,0,0);stop-opacity:1" />
    </linearGradient>
    <clipPath id="clip1">
      <rect x="0" y="0" width="200" height="100"/>
    </clipPath>
    <mask id="mask1">
      <rect x="0" y="0" width="100" height="100" fill="white"/>
    </mask>
    <g id="component-symbol">
      <circle cx="25" cy="25" r="20" fill="url(#grad1)"/>
    </g>
  </defs>
  <g clip-path="url(#clip1)" mask="url(#mask1)">
    <use href="#component-symbol" x="50" y="50"/>
  </g>
  <text x="20" y="250" font-size="14">
    Header <tspan fill="blue" font-weight="bold">Highlighted</tspan>
  </text>
</svg>
`.trim();

		const res = validateVisualArtifact({
			version: 1,
			id: "valid-complex-svg",
			title: "Valid Complex SVG",
			renderer: "svg",
			source: validComplexSvg,
		});

		assert.equal(res.valid, true, `Expected valid complex SVG to pass validation: ${res.problems.join(", ")}`);
		assert.equal(res.problems.length, 0);
	});
});
