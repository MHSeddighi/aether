import { useCallback, useState, type ComponentPropsWithoutRef } from 'react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import { Check, Copy } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import { useWorkspace } from '../../context/WorkspaceContext';

/**
 * Assistant markdown, rendered as prose.
 *
 * Assistant UI's markdown primitive does the parsing — including the streaming cases, where a half
 * arrived code fence or an unclosed emphasis must not flicker the layout — and the components below
 * decide how it *looks*. The styling target is editorial text, not a document viewer: headings carry
 * hierarchy, lists stay tight, and only code and tables get a surface, because those are the two
 * things a reader needs to visually separate from prose.
 *
 * Streaming is passed through untouched (`smooth={false}`): the reveal rate is the backend's, and
 * animating text on top of it would misrepresent how fast the bot is actually answering.
 */

const prose = 'text-[14px] leading-[1.7] text-[var(--md-sys-color-on-surface)]';

/** Inline code: quiet, but distinct from prose it sits inside. */
const InlineCode: React.FC<ComponentPropsWithoutRef<'code'>> = ({ children, ...rest }) => (
  <code
    {...rest}
    className="rounded bg-[var(--md-sys-color-surface-container)] px-1 py-px font-mono text-[0.86em] text-[var(--md-sys-color-on-surface)]"
  >
    {children}
  </code>
);

/**
 * The header above a code block: language, and the only action code ever needs.
 *
 * Copy lives here rather than floating over the block, because a control that appears on hover
 * over text is unreadable at exactly the moment it is needed.
 */
const CodeHeader: React.FC<{ language?: string; code: string }> = ({ language, code }) => {
  const { t } = useWorkspace();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the code is still selectable on screen.
    }
  }, [code]);

  return (
    <div className="flex items-center justify-between border-b border-[var(--md-sys-color-outline-variant)] px-2.5 py-1">
      <span className="font-mono text-[10px] tracking-wide text-[var(--md-sys-color-on-surface-variant)]">
        {language || 'code'}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        data-testid="code-copy"
        aria-label={copied ? t.copied : t.copyCode}
        className="flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 text-[11px] text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:bg-[var(--md-sys-color-state-hover)] hover:text-[var(--md-sys-color-on-surface)]"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? t.copied : t.copy}
      </button>
    </div>
  );
};

/**
 * A code block: a hairline border, horizontal scroll, no shadow.
 *
 * Scrolls sideways rather than wrapping because wrapped code destroys the alignment that makes it
 * readable, and the block stays inside the reading column so it never widens the transcript.
 */
const CodeBlock: React.FC<ComponentPropsWithoutRef<'pre'>> = ({ children, ...rest }) => (
  <pre
    {...rest}
    className="my-2.5 overflow-x-auto rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] p-2.5 font-mono text-[12px] leading-5 text-[var(--md-sys-color-on-surface)]"
  >
    {children}
  </pre>
);

const heading =
  'mt-4 mb-1.5 font-semibold tracking-tight text-[var(--md-sys-color-on-surface)] first:mt-0';

/**
 * Markdown components.
 *
 * Built once at module scope: the renderer memoises on component identity, and an inline object
 * would rebuild the tree on every streamed token.
 */
export const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className={`${heading} text-[19px]`}>{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className={`${heading} text-[17px]`}>{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className={`${heading} text-[15px]`}>{children}</h3>,
  h4: ({ children }: { children?: React.ReactNode }) => <h4 className={`${heading} text-[14px]`}>{children}</h4>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="my-2 list-disc space-y-1 ps-5 marker:text-[var(--md-sys-color-on-surface-variant)]">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="my-2 list-decimal space-y-1 ps-5 marker:text-[var(--md-sys-color-on-surface-variant)]">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="ps-0.5">{children}</li>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2.5 border-s-2 border-[var(--md-sys-color-outline-variant)] ps-3 text-[var(--md-sys-color-on-surface-variant)]">
      {children}
    </blockquote>
  ),
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      // `noopener` stops the opened page reaching back through `window.opener`.
      rel="noopener noreferrer"
      className="text-[var(--md-sys-color-primary)] underline decoration-[var(--md-sys-color-primary)]/40 underline-offset-2 transition-colors hover:decoration-[var(--md-sys-color-primary)]"
    >
      {children}
    </a>
  ),
  code: InlineCode,
  pre: CodeBlock,
  CodeHeader,
  SyntaxHighlighter: ({ components: { Pre, Code }, code, node }: {
    components: { Pre: typeof CodeBlock; Code: typeof InlineCode };
    code: string | React.ReactNode | undefined;
    node?: unknown;
  }) => (
    <Pre node={node as never}>
      <Code node={node as never}>{code}</Code>
    </Pre>
  ),
  // Tables get a surface because they are read by scanning across, not by reading prose.
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-2.5 overflow-x-auto rounded-lg border border-[var(--md-sys-color-outline-variant)]">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-[var(--md-sys-color-surface-container-low)]">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border-b border-[var(--md-sys-color-outline-variant)] px-2.5 py-1.5 text-start font-medium text-[var(--md-sys-color-on-surface)]">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border-b border-[var(--md-sys-color-outline-variant)] px-2.5 py-1.5 align-top text-[var(--md-sys-color-on-surface)] last:border-b-0">
      {children}
    </td>
  ),
  hr: () => <hr className="my-4 border-0 border-t border-[var(--md-sys-color-outline-variant)]" />,
};

/** Renders markdown for an assistant turn. */
export const AssistantMarkdown: React.FC<{ testId?: string }> = ({ testId }) => (
  <MarkdownTextPrimitive
    // GFM covers tables, strikethrough and task lists, which models emit whenever a comparison is
    // clearer as a table.
    remarkPlugins={[remarkGfm]}
    smooth={false}
    components={markdownComponents}
    className={`${prose} break-words`}
    containerProps={{ 'data-testid': testId } as never}
  />
);