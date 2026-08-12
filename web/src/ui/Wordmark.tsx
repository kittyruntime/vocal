export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      V<span className="wordmark-accent">O</span>CAL
    </span>
  );
}
