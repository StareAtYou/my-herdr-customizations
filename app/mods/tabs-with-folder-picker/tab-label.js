export function folderKey(folder) {
  if (!folder) return "";
  const path = folder.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^(?:[A-Za-z]:|\/\/)/.test(path) ? path.toLowerCase() : path;
}

function projectName(space, pane, userHome, projectFolders, repo) {
  const root = folderKey(space?.folder);
  if (!root || root === "~" || (!space.machine && root === folderKey(userHome))) return null;
  if (repo || (!space.machine && projectFolders.some(path => folderKey(path) === root))) return space.name;

  // Herdr derives a folder even for an ad hoc space. Require Git evidence for
  // those spaces and keep non-Git folders explicitly selected in the picker.
  const cwd = folderKey(pane?.cwd);
  if (pane?.branch && (cwd === root || cwd.startsWith(root + "/"))) return space.name;
  return null;
}

export function tabLabel(tab, space, pane, userHome, projectFolders = [], repo = false) {
  const program = pane?.program;
  const tabName = tab.name?.trim();
  const native = program?.name?.trim() || pane?.app || "Agent";
  if (!program?.agent) {
    const label = tabName && !/^tb\d+$/.test(tabName) ? tabName : program?.name || "Terminal";
    return { label, detail: null, tooltip: label };
  }
  const project = projectName(space, pane, userHome, projectFolders, repo);
  const label = project && tab.named && tabName && tabName !== native ? tabName : native;
  const detail = project && project !== label ? project : null;
  const tooltip = [...new Set([label, detail, project ? native : null, project ? space.folder : null].filter(Boolean))].join(" · ");
  return { label, detail, tooltip };
}
