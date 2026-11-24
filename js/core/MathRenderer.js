/**
 * MathRenderer — KaTeX adapter for all authored and live mathematical formulas.
 * The app remains usable when the CDN is unavailable; formulas then fall back to text.
 */
const MATH_DELIMITERS = [
  { left: '\\[', right: '\\]', display: true },
  { left: '\\(', right: '\\)', display: false },
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false }
];
const HAS_DELIMITED_MATH = /\\\(|\\\[|\$\$|\$[^$]+\$/;
let katexWarningShown = false;

const UNICODE_LATEX = [
  [/ℕ/g, String.raw`\mathbb{N}`],
  [/ℤ/g, String.raw`\mathbb{Z}`],
  [/ℚ/g, String.raw`\mathbb{Q}`],
  [/ℝ/g, String.raw`\mathbb{R}`],
  [/ℂ/g, String.raw`\mathbb{C}`],
  [/𝒫/g, String.raw`\mathcal{P}`],
  [/ℵ₀/g, String.raw`\aleph_0`],
  [/ℵ₁/g, String.raw`\aleph_1`],
  [/ℵ₂/g, String.raw`\aleph_2`],
  [/ℵ₃/g, String.raw`\aleph_3`],
  [/ℵ₄/g, String.raw`\aleph_4`],
  [/ℵ₅/g, String.raw`\aleph_5`],
  [/ℵ/g, String.raw`\aleph`],
  [/φ/g, String.raw`\varphi`],
  [/π/g, String.raw`\pi`],
  [/λ/g, String.raw`\lambda`],
  [/∼/g, String.raw`\sim`],
  [/~/g, String.raw`\sim`],
  [/⇒/g, String.raw`\Rightarrow`],
  [/∪/g, String.raw`\cup`],
  [/∩/g, String.raw`\cap`],
  [/⊂/g, String.raw`\subset`],
  [/⊆/g, String.raw`\subseteq`],
  [/∅/g, String.raw`\varnothing`],
  [/∀/g, String.raw`\forall`],
  [/∃/g, String.raw`\exists`],
  [/≈/g, String.raw`\approx`],
  [/∝/g, String.raw`\propto`],
  [/√/g, String.raw`\sqrt{}`],
  [/∞/g, String.raw`\infty`],
  [/∈/g, String.raw`\in`],
  [/∉/g, String.raw`\notin`],
  [/→/g, String.raw`\to`],
  [/↦/g, String.raw`\mapsto`],
  [/⋯/g, String.raw`\cdots`],
  [/…/g, String.raw`\ldots`],
  [/≤/g, String.raw`\le`],
  [/≥/g, String.raw`\ge`],
  [/≠/g, String.raw`\ne`],
  [/×/g, String.raw`\times`],
  [/Σ/g, String.raw`\Sigma`],
  [/θ/g, String.raw`\theta`],
  [/−/g, '-'],
  [/°/g, String.raw`^{\circ}`],
  [/²/g, '^{2}'],
  [/³/g, '^{3}'],
  [/₀/g, '_{0}'],
  [/₁/g, '_{1}'],
  [/₂/g, '_{2}'],
  [/₃/g, '_{3}'],
  [/₄/g, '_{4}'],
  [/₅/g, '_{5}']
];

export function toLatex(source = '') {
  let value = String(source);
  UNICODE_LATEX.forEach(([pattern, replacement]) => { value = value.replace(pattern, replacement); });
  value = value.replace(/\^\|([^|]+)\|/g, String.raw`^{\lvert $1 \rvert}`);
  value = value.replace(/\|([^|]+)\|/g, String.raw`\lvert $1 \rvert`);
  return value;
}

export function renderDisplayFormula(target, source) {
  if (!target) return;
  const latex = toLatex(source);
  if (window.katex?.render) {
    window.katex.render(latex, target, {
      displayMode: true,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml'
    });
    target.dataset.mathRendered = 'true';
  } else {
    target.textContent = source;
    target.dataset.mathRendered = 'fallback';
    reportKatexUnavailable();
  }
}

export function renderMathInElementSafe(root) {
  if (!root) return false;
  if (!window.renderMathInElement || !window.katex?.render) {
    if (HAS_DELIMITED_MATH.test(root.textContent || '')) reportKatexUnavailable();
    return false;
  }
  window.renderMathInElement(root, {
    delimiters: MATH_DELIMITERS,
    throwOnError: false,
    strict: 'ignore',
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
  });
  return true;
}


const INLINE_MATH_TOKEN = /(\|[^|]+\||2\^ℵ[₀₁₂₃₄₅]|ℵ[₀₁₂₃₄₅]|ℕ₀|[ℕℤℚℝℂ]|𝒫\(A\)|gcd\([^)]*\)\s*=\s*1|p\/q|q\s*>\s*0|2ⁿ|2\^n|v\s*[~∼]\s*λv|f\s*:\s*A\s*→\s*𝒫\(A\)|D\s*=\s*\{[^}]+\}|φ²|φ|π|Σθ\s*[<>]=?\s*180°|V-E\+F=2)/g;

export function renderInlineMathText(target, source = '') {
  if (!target) return;
  const text = String(source);
  if (target.dataset.mathSource === text && target.childNodes.length) return;
  target.dataset.mathSource = text;
  target.replaceChildren();
  if (HAS_DELIMITED_MATH.test(text)) {
    target.textContent = text;
    renderMathInElementSafe(target);
    return;
  }
  let cursor = 0;
  for (const match of text.matchAll(INLINE_MATH_TOKEN)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) target.append(document.createTextNode(text.slice(cursor, index)));
    const math = document.createElement('span');
    math.className = 'math-inline';
    math.textContent = `\\(${toLatex(token)}\\)`;
    target.append(math);
    cursor = index + token.length;
  }
  if (cursor < text.length) target.append(document.createTextNode(text.slice(cursor)));
  if (target.querySelector('.math-inline')) renderMathInElementSafe(target);
}

export function setMathReadout(target, text) {
  if (!target) return;
  target.textContent = text;
  renderMathInElementSafe(target);
}

function reportKatexUnavailable() {
  if (katexWarningShown) return;
  katexWarningShown = true;
  console.error('KaTeX failed to load; mathematical content could not be typeset.');
}
