/**
 * Truncates a filename in the middle while keeping the extension.
 */
export const truncateFilename = (filename: string, maxLen: number): string => {
  if (filename.length <= maxLen) return filename;
  const parts = filename.split('.');
  const ext = parts.pop() || '';
  const name = parts.join('.');
  const half = Math.floor((maxLen - ext.length - 4) / 2);
  if (half <= 0) return filename.slice(0, maxLen - 3) + '...';
  return `${name.slice(0, half)}...${name.slice(-half)}.${ext}`;
};

/**
 * Smartly truncates only the filename part of a status string.
 */
export const smartTruncate = (str: string, maxLength: number = 50): string => {
  if (!str || str.length <= maxLength) return str;

  // Find the filename (typically a word with an extension)
  const words = str.split(' ');
  const resultWords = words.map(word => {
    const hasExtension = /\.[a-zA-Z0-9]{2,5}$/.test(word);
    if (hasExtension && word.length > 20) {
      return truncateFilename(word, 20);
    }
    return word;
  });

  const processed = resultWords.join(' ');
  if (processed.length <= maxLength) return processed;
  
  // Fallback to basic mid-truncation if still too long
  const mid = Math.floor(maxLength / 2);
  return processed.slice(0, mid - 2) + '...' + processed.slice(-mid + 2);
};
