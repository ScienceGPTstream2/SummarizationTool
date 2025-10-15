import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import parse from "html-react-parser";

interface MarkdownViewerProps {
  content: string;
  className?: string;
}

export function MarkdownViewer({
  content,
  className = "",
}: MarkdownViewerProps) {
  // Check if content has HTML tables
  const hasHTMLTables = content.includes("<table");

  if (hasHTMLTables) {
    // For content with HTML tables, use html-react-parser for direct HTML rendering
    return (
      <div
        className={`prose prose-sm max-w-none ${className}`}
        style={{
          fontSize: "0.75rem",
          lineHeight: "1rem",
        }}
      >
        <style>{`
          .prose table {
            border-collapse: collapse;
            width: 100%;
            margin: 1rem 0;
            border: 1px solid hsl(var(--border));
            background: hsl(var(--background));
          }
          .prose th {
            border: 1px solid hsl(var(--border));
            padding: 0.75rem;
            text-align: left;
            font-weight: 500;
            background: hsl(var(--muted));
            color: hsl(var(--foreground));
            font-size: 0.75rem;
          }
          .prose td {
            border: 1px solid hsl(var(--border));
            padding: 0.75rem;
            font-size: 0.75rem;
            color: hsl(var(--foreground));
          }
          .prose tr:hover {
            background: hsl(var(--muted) / 0.3);
          }
          .prose caption {
            font-weight: 500;
            margin-bottom: 0.5rem;
            text-align: left;
            color: hsl(var(--foreground));
            font-size: 0.875rem;
          }
          .prose thead {
            background: hsl(var(--muted));
          }
          .prose h1 {
            font-size: 1.25rem;
            font-weight: 500;
            line-height: 1.2;
            margin-bottom: 1rem;
            margin-top: 0;
            color: hsl(var(--foreground));
          }
          .prose h2 {
            font-size: 1.125rem;
            font-weight: 500;
            line-height: 1.2;
            margin-bottom: 0.75rem;
            margin-top: 1.5rem;
            color: hsl(var(--foreground));
          }
          .prose h3 {
            font-size: 1rem;
            font-weight: 500;
            line-height: 1.2;
            margin-bottom: 0.5rem;
            margin-top: 1rem;
            color: hsl(var(--foreground));
          }
          .prose p {
            font-size: 0.875rem;
            line-height: 1.5;
            margin-bottom: 0.75rem;
            color: hsl(var(--foreground));
          }
          .prose ul, .prose ol {
            padding-left: 1rem;
            margin-bottom: 0.75rem;
          }
          .prose li {
            font-size: 0.875rem;
            line-height: 1.5;
            margin-bottom: 0.25rem;
            color: hsl(var(--foreground));
          }
          .prose strong {
            font-weight: 600;
          }
          .prose em {
            font-style: italic;
          }
          .prose blockquote {
            border-left: 4px solid hsl(var(--primary));
            padding-left: 1rem;
            font-style: italic;
            margin: 1rem 0;
            color: hsl(var(--muted-foreground));
          }
        `}</style>
        {parse(content)}
      </div>
    );
  }

  // For regular markdown content without HTML tables
  return (
    <div className={`prose prose-sm max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Override default styling to work with our design system
          h1: ({ children }) => (
            <h1 className="text-xl font-medium leading-tight mb-4 mt-0 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-medium leading-tight mb-3 mt-6 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-medium leading-tight mb-2 mt-4 first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-medium leading-tight mb-2 mt-3 first:mt-0">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="text-sm leading-relaxed mb-3 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-4 mb-3 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-4 mb-3 space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm leading-relaxed">{children}</li>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-4">
              <table className="min-w-full border-collapse border border-border bg-background">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-border hover:bg-muted/50">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="border border-border px-3 py-2 text-left text-xs font-medium text-foreground bg-muted">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-2 text-xs">
              {children}
            </td>
          ),
          caption: ({ children }) => (
            <caption className="text-sm font-medium text-foreground mb-2 text-left">
              {children}
            </caption>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary pl-4 italic my-4 text-muted-foreground">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) => {
            // Inline code
            if (!className) {
              return (
                <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">
                  {children}
                </code>
              );
            }
            // Code blocks
            return (
              <pre className="bg-muted p-3 rounded text-xs font-mono overflow-x-auto mb-4">
                <code className={className}>{children}</code>
              </pre>
            );
          },
          strong: ({ children }) => (
            <strong className="font-medium">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
