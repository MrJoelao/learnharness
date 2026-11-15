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

	// ── Phase 6.4: CSS Escape Validation & URL Normalization Test Suite ──────────

	it("Phase 6.4: rejects CSS escape in function name (u\\72l) (Section 2.1)", () => {
		const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u\\72l(file:///etc/passwd)"/></svg>';
		const res = validateVisualArtifact({
			version: 1,
			id: "phase64-escape-fn",
			title: "Escape Function Name Test",
			renderer: "svg",
			source,
		});
		assert.equal(res.valid, false, "Must reject u\\72l escape in function name");
		assert.ok(
			res.problems.some((p) => p.includes("external URLs") || p.includes("non-fragment")),
			"Must report forbidden external/non-fragment URL violation",
		);
	});

	it("Phase 6.4: rejects CSS escape in URL scheme (url(\\66ile:///...)) (Section 2.2)", () => {
		const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(\\66ile:///etc/passwd)"/></svg>';
		const res = validateVisualArtifact({
			version: 1,
			id: "phase64-escape-scheme",
			title: "Escape Scheme Test",
			renderer: "svg",
			source,
		});
		assert.equal(res.valid, false, "Must reject \\66ile escape in URL scheme");
		assert.ok(
			res.problems.some((p) => p.includes("external URLs") || p.includes("non-fragment")),
			"Must report forbidden external/non-fragment URL violation",
		);
	});

	it("Phase 6.4: accepts legitimate local fragment URL (#safe) including with normalized valid escapes (Section 2.3)", () => {
		const validBaseSvg = `
<svg xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="safe">
      <stop offset="0%" stop-color="red"/>
    </linearGradient>
  </defs>
  <rect fill="url(#safe)"/>
</svg>
`.trim();

		const res = validateVisualArtifact({
			version: 1,
			id: "phase64-safe-url",
			title: "Legitimate Local URL Test",
			renderer: "svg",
			source: validBaseSvg,
		});
		assert.equal(res.valid, true, `Expected safe local URL to pass validation: ${res.problems.join(", ")}`);
		assert.equal(res.problems.length, 0);

		// Also verify legitimate local fragment with normalized valid escapes
		const validEscapedSvgs = [
			'<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="safe"><stop offset="0%" stop-color="red"/></linearGradient></defs><rect fill="u\\72l(#safe)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="safe"><stop offset="0%" stop-color="red"/></linearGradient></defs><rect fill="url(\\23 safe)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="safe"><stop offset="0%" stop-color="red"/></linearGradient></defs><rect fill="url(\\#safe)"/></svg>',
		];

		for (const source of validEscapedSvgs) {
			const r = validateVisualArtifact({
				version: 1,
				id: "phase64-safe-escaped",
				title: "Safe Escaped Test",
				renderer: "svg",
				source,
			});
			assert.equal(r.valid, true, `Expected valid escaped local URL to pass: ${r.problems.join(", ")}`);
		}
	});

	it("Phase 6.4: handles hexadecimal escapes with/without optional terminator and multi-digit hex (Section 2.4)", () => {
		const escapeCases = [
			// hex escape without space terminator
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u\\72l(file:///etc/passwd)"/></svg>',
			// hex escape with space terminator
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u\\72 l(file:///etc/passwd)"/></svg>',
			// hex escape with multiple digits (up to 6 digits)
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u\\000072l(file:///etc/passwd)"/></svg>',
			// escape that changes the function name completely
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="\\75\\72\\6c(https://evil.com/leak)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="\\55\\52\\4c(https://evil.com/leak)"/></svg>',
			// escape that changes the URL scheme
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(\\68\\74\\74\\70\\73://evil.com/leak)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(\\66ile:///etc/passwd)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(\\66 ile:///etc/passwd)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(\\000066ile:///etc/passwd)"/></svg>',
			// simple escape changing the scheme
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(\\f\\i\\l\\e\\:\\/\\/\\/etc/passwd)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(fi\\le:///etc/passwd)"/></svg>',
		];

		for (const source of escapeCases) {
			const res = validateVisualArtifact({
				version: 1,
				id: "phase64-escape-terminators",
				title: "Escape Terminators Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected ${source} to be rejected`);
			assert.ok(
				res.problems.some((p) => p.includes("external URLs") || p.includes("non-fragment") || p.includes("malformed")),
				`Must report security violation for ${source}`,
			);
		}
	});

	it("Phase 6.4: prevents CSS comments from bypassing or obfuscating url() checks (Section 2.5)", () => {
		const hostileCommentCases = [
			// comment between tokens
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="/* comment */ url(file:///etc/passwd)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(/* comment */ file:///etc/passwd)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(file:///etc/passwd) /* comment */"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url /* comment */ (file:///etc/passwd)"/></svg>',
			// comment splitting keyword
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u/* comment */rl(file:///etc/passwd)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(fi/* comment */le:///etc/passwd)"/></svg>',
			// combinations of comments and escapes
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u\\72l/* comment */(file:///etc/passwd)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="/* comment */ u\\72l(\\66ile:///etc/passwd)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u/*comment*/\\72l(file:///etc/passwd)"/></svg>',
			// unclosed comment
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#safe) /* unclosed"/></svg>',
		];

		for (const source of hostileCommentCases) {
			const res = validateVisualArtifact({
				version: 1,
				id: "phase64-comments",
				title: "CSS Comments Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected comment evasion ${source} to be rejected`);
			assert.ok(res.problems.length > 0);
		}

		// Valid local URLs with comments should be accepted
		const safeCommentCases = [
			'<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="safe"><stop offset="0%" stop-color="red"/></linearGradient></defs><rect fill="/* safe comment */ url(#safe) /* safe comment */"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="safe"><stop offset="0%" stop-color="red"/></linearGradient></defs><rect fill="url( /* safe comment */ #safe /* safe comment */ )"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="safe"><stop offset="0%" stop-color="red"/></linearGradient></defs><rect fill="/* comment */ url(\\23 safe) /* comment */"/></svg>',
		];

		for (const source of safeCommentCases) {
			const res = validateVisualArtifact({
				version: 1,
				id: "phase64-safe-comments",
				title: "Safe Comments Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, true, `Expected safe commented SVG to pass: ${res.problems.join(", ")}`);
		}
	});

	it("Phase 6.4: inspects multiple url() functions in a single attribute fail-closed (Section 2.6)", () => {
		// All valid local URLs
		const allValid = '<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="c1"/><clipPath id="c2"/></defs><rect clip-path="url(#c1) url(#c2)"/></svg>';
		const resValid = validateVisualArtifact({
			version: 1,
			id: "phase64-multi-valid",
			title: "Multiple Valid URLs",
			renderer: "svg",
			source: allValid,
		});
		assert.equal(resValid.valid, true, `Expected multiple valid local URLs to pass: ${resValid.problems.join(", ")}`);

		// One valid local, one external URL
		const mixed = '<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="c1"/></defs><rect clip-path="url(#c1) url(https://evil.com/leak)"/></svg>';
		const resMixed = validateVisualArtifact({
			version: 1,
			id: "phase64-multi-mixed",
			title: "Multiple Mixed URLs",
			renderer: "svg",
			source: mixed,
		});
		assert.equal(resMixed.valid, false, "Must reject mixed local and external URLs");
		assert.ok(
			resMixed.problems.some((p) => p.includes("external URLs") || p.includes("non-fragment")),
		);

		// Multiple external URLs
		const allExternal = '<svg xmlns="http://www.w3.org/2000/svg"><rect clip-path="url(file:///etc/passwd) url(https://evil.com/leak)"/></svg>';
		const resAllExternal = validateVisualArtifact({
			version: 1,
			id: "phase64-multi-ext",
			title: "Multiple External URLs",
			renderer: "svg",
			source: allExternal,
		});
		assert.equal(resAllExternal.valid, false, "Must reject multiple external URLs");
	});

	it("Phase 6.4: enforces CSS URL escape validation across all CSS-valued presentational attributes (Section 2.7)", () => {
		const attributesToTest = ["fill", "stroke", "filter", "clip-path", "mask"];

		for (const attr of attributesToTest) {
			// 1. Function name escape bypass attempt
			const fnEscapeSvg = `<svg xmlns="http://www.w3.org/2000/svg"><rect ${attr}="u\\72l(file:///etc/passwd)"/></svg>`;
			const resFn = validateVisualArtifact({
				version: 1,
				id: `phase64-attr-fn-${attr}`,
				title: `Attribute ${attr} fn escape test`,
				renderer: "svg",
				source: fnEscapeSvg,
			});
			assert.equal(resFn.valid, false, `Attribute ${attr} must reject function escape u\\72l`);
			assert.ok(
				resFn.problems.some((p) => p.includes("external URLs") || p.includes("non-fragment")),
				`Attribute ${attr} must flag external URL`,
			);

			// 2. Scheme escape bypass attempt
			const schemeEscapeSvg = `<svg xmlns="http://www.w3.org/2000/svg"><rect ${attr}="url(\\66ile:///etc/passwd)"/></svg>`;
			const resScheme = validateVisualArtifact({
				version: 1,
				id: `phase64-attr-scheme-${attr}`,
				title: `Attribute ${attr} scheme escape test`,
				renderer: "svg",
				source: schemeEscapeSvg,
			});
			assert.equal(resScheme.valid, false, `Attribute ${attr} must reject scheme escape \\66ile`);
			assert.ok(
				resScheme.problems.some((p) => p.includes("external URLs") || p.includes("non-fragment")),
				`Attribute ${attr} must flag external URL`,
			);

			// 3. Valid local reference must pass
			const validAttrSvg = `<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="safe"/></defs><rect ${attr}="url(#safe)"/></svg>`;
			const resValid = validateVisualArtifact({
				version: 1,
				id: `phase64-attr-valid-${attr}`,
				title: `Attribute ${attr} valid test`,
				renderer: "svg",
				source: validAttrSvg,
			});
			assert.equal(resValid.valid, true, `Attribute ${attr} must accept valid local url(#safe): ${resValid.problems.join(", ")}`);
		}
	});

	it("Phase 6.4: rejects malformed url() syntax, unclosed quotes, unbalanced parentheses, and invalid fragments", () => {
		const malformedCases = [
			// unclosed quote
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(\'file:///etc/passwd)"/></svg>',
			// mismatched quotes
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(\'file:///etc/passwd\\")"/></svg>',
			// missing closing paren
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(file:///etc/passwd"/></svg>',
			// extra closing paren / unbalanced paren
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#safe))"/></svg>',
			// nested unquoted paren
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url((#safe))"/></svg>',
			// empty fragment
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#)"/></svg>',
			// fragment with query or path parameters
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#safe?version=1)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#safe/path)"/></svg>',
			// relative and external paths with fragment
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(../icon.svg#safe)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(/icon.svg#safe)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(//cdn.org/icon.svg#safe)"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(data:image/svg+xml,...#safe)"/></svg>',
		];

		for (const source of malformedCases) {
			const res = validateVisualArtifact({
				version: 1,
				id: "phase64-malformed-urls",
				title: "Malformed URLs Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected ${source} to be rejected fail-closed`);
			assert.ok(res.problems.length > 0);
		}
	});
});
