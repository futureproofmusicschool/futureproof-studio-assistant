function mergeTranscriptText(previous, next) {
  const before = previous || "";
  const addition = next || "";
  if (!before) return addition;
  if (!addition) return before;

  const maxOverlap = Math.min(before.length, addition.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (before.slice(-size) === addition.slice(0, size)) {
      return before + addition.slice(size);
    }
  }

  const needsSpace = !/\s$/.test(before) && !/^\s/.test(addition);
  return needsSpace ? `${before} ${addition}` : before + addition;
}

module.exports = { mergeTranscriptText };
