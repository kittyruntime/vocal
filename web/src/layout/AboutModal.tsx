import { useEffect, useState } from "react";
import { getChangelog, type VersionInfo } from "../api/client";
import { Markdown } from "../ui/Markdown";

export function AboutModal({ version, onClose }: { version: VersionInfo; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  useEffect(() => { void getChangelog().then(setContent).catch(() => setContent("Unable to load changelog.")); }, []);
  return <div className="about-backdrop" role="presentation" onClick={onClose}>
    <section className="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
      <div className="about-heading"><div><p className="about-eyebrow">ABOUT VOCAL</p><h2 id="about-title">Vocal</h2></div></div>
      <p className="version-meta">A calm, focused space for conversation.</p>
      {content === null ? <p>Loading changelog…</p> : <Markdown content={content} />}
      <p className="about-build">v{version.version} · build {version.build}</p>
    </section>
  </div>;
}
