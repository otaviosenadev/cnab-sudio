import type { ReactNode } from 'react';

/** Markdown mínimo e seguro (sem HTML): parágrafos, listas, **negrito**, `código`. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong>);
    else out.push(<code key={`${key}-${i++}`}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  return (
    <div className="rich">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '');
        if (!lines.length) return null;
        const bullet = lines.every((l) => /^\s*[-*•]\s+/.test(l));
        const ordered = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
        if (bullet || ordered) {
          const Tag = ordered ? 'ol' : 'ul';
          return (
            <Tag key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), `${bi}-${li}`)}</li>
              ))}
            </Tag>
          );
        }
        const heading = lines.length === 1 && /^#{1,4}\s+/.test(lines[0]!);
        if (heading) return <h4 key={bi}>{inline(lines[0]!.replace(/^#{1,4}\s+/, ''), `${bi}`)}</h4>;
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {inline(l.replace(/^#{1,4}\s+/, ''), `${bi}-${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
