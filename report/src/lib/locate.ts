export function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * Candidate descent paths from a granted folder to a target: for every place
 * the folder's name appears in the path, the segments that remain below it.
 * The picker cannot start at a path, so grants are matched by name instead;
 * a wrong match is rejected later when the store fails to verify.
 */
export function candidateDescents(rootName: string, path: string): string[][] {
  const segments = pathSegments(path);
  const descents: string[][] = [];
  segments.forEach((segment, i) => {
    if (segment === rootName) descents.push(segments.slice(i + 1));
  });
  return descents.sort((a, b) => a.length - b.length);
}

export async function descend(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle | null> {
  let dir = root;
  for (const segment of segments) {
    try {
      dir = await dir.getDirectoryHandle(segment);
    } catch {
      return null;
    }
  }
  return dir;
}
