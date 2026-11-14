#!/usr/bin/env python3
"""Plan, install and restore the files owned by the macOS customization."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shlex
import shutil
import stat
import tempfile

PLATFORM = Path(__file__).resolve().parent
ROOT = PLATFORM.parents[1]
HOME = Path(os.environ.get('HERDR_APP_HOME') or Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config') / 'herdr-app').resolve()
BINDINGS = {
    'cmd-shift-n': 'mod.open:choose-workspace-folder',
    'cmd-alt-shift-j': 'agents-workspace.next-blocked',
    'cmd-shift-,': 'mod.open:workspace-appearance',
    'cmd-alt-p': 'mod.open:workspace-actions',
}


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def read_json(path, default):
    return json.loads(path.read_bytes()) if path.exists() else default


def executable(name):
    for candidate in (Path('/opt/homebrew/bin') / name, Path('/usr/local/bin') / name, Path.home() / '.local/bin' / name):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return shutil.which(name)


def plan():
    generated = {}
    node, codebuddy = executable('node'), executable('codebuddy')
    if not node:
        print('Node.js unavailable. Existing CodeBuddy program configuration will be preserved.')
    for root in (ROOT / 'app', PLATFORM / 'app'):
        for path in sorted(root.rglob('*')):
            if path.is_file() and path.name not in {'gpui-kit.d.ts', 'jsconfig.json', '.DS_Store', 'README.md'}:
                generated[str(path.relative_to(root))] = (path.read_bytes(), stat.S_IMODE(path.stat().st_mode))

    layout = 'layouts/workspace-folders.json'
    doc = json.loads(generated[layout][0])
    current = read_json(HOME / layout, {})
    for key in ('background', 'terminal_opacity'):
        if key in current:
            doc[key] = current[key]

    def find(node, name):
        if node.get('id') == name:
            return node
        return next((found for child in node.get('children', [])
                     if (found := find(child, name)) is not None), None)

    previous_sidebar = find(current, 'sidebar') or {}
    sidebar = find(doc, 'sidebar')
    for key in ('background', 'size'):
        if key in previous_sidebar:
            sidebar[key] = previous_sidebar[key]
    previous_pane = (find(current, 'main') or {}).get('content', {}).get('pane') or {}
    if 'background' in previous_pane:
        find(doc, 'main')['content']['pane']['background'] = previous_pane['background']
    doc['traffic_lights'] = [12, 16]
    generated[layout] = (json_bytes(doc), 0o644)

    hook = 'launchers/agent-status/codebuddy-hooks.json'
    if node:
        doc = read_json(ROOT / 'config/codebuddy-hooks.json', {})
        for group in doc['hooks'].values():
            for entry in group:
                for step in entry['hooks']:
                    event = shlex.split(step['command'])[-1]
                    step['command'] = shlex.join([node, str(HOME / 'launchers/agent-status/hook.cjs'), event])
        generated[hook] = (json_bytes(doc), 0o644)

    source = read_json(PLATFORM / 'config/programs.json', {})['programs']
    previous_programs = read_json(HOME / 'programs.json', {})
    programs = previous_programs.setdefault('programs', {})
    for name, entry in source.items():
        if name == 'codebuddy-code' and not (node and codebuddy):
            continue
        if name == 'qoder' and not any(executable(x) for x in ('qodercli', 'qoder', 'qodercn')):
            launcher = Path.home() / '.qoder/bin/qodercli'
            if not any(p.is_file() and os.access(p, os.X_OK) for p in launcher.glob('qodercli*')):
                continue
        if name == 'dsh-tui' and not executable('dsh'):
            continue
        entry['run'] = [
            str(HOME / item.removeprefix('{appHome}/')) if item.startswith('{appHome}/')
            else {'{node}': node, '{codebuddy}': codebuddy}.get(item, item)
            for item in entry['run']
        ]
        icon = entry.get('icon')
        if icon and not (HOME / icon).exists():
            del entry['icon']
        programs[name] = {**programs.get(name, {}), **entry}
    generated['programs.json'] = (json_bytes(previous_programs), 0o644)

    keys = read_json(HOME / 'keys.json', {})
    global_keys = keys.setdefault('global', {})
    for shortcut, action in BINDINGS.items():
        if shortcut in global_keys and global_keys[shortcut] != action:
            print(f'Keeping existing binding {shortcut} → {global_keys[shortcut]}')
        else:
            global_keys[shortcut] = action
    generated['keys.json'] = (json_bytes(keys), 0o644)
    for name, (data, _) in generated.items():
        if name.endswith('.json'):
            json.loads(data)
    return generated


def safe_target(root, name):
    relative = Path(name)
    if relative.is_absolute() or '..' in relative.parts or not relative.parts:
        raise ValueError(f'invalid manifest path {name!r}')
    target = root / relative
    if not target.resolve().is_relative_to(root):
        raise ValueError(f'path outside {root}: {name}')
    return target


def atomic(target, data, mode):
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=f'.{target.name}.', delete=False) as output:
        staged = Path(output.name)
        try:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
            os.chmod(staged, mode)
            os.replace(staged, target)
        finally:
            staged.unlink(missing_ok=True)


def restore(backup, entries, check_current=False):
    for entry in entries:
        target = safe_target(HOME, entry['path'])
        if check_current and (target.is_symlink() or not target.is_file() or target.read_bytes() != safe_target(backup / 'after', entry['path']).read_bytes()):
            raise ValueError(f'{target} changed after apply. Restore stopped to preserve those edits.')
    for entry in entries:
        target = safe_target(HOME, entry['path'])
        if entry['existed']:
            atomic(target, safe_target(backup / 'before', entry['path']).read_bytes(), entry['mode'])
        else:
            target.unlink(missing_ok=True)


def apply(dry_run):
    changes = {}
    for name, (data, mode) in plan().items():
        target = safe_target(HOME, name)
        if target.is_symlink():
            raise ValueError(f'expected a regular file for {name}')
        if target.is_file() and target.read_bytes() == data and stat.S_IMODE(target.stat().st_mode) == mode:
            continue
        changes[name] = (data, mode)
        print(f'{"Update" if target.exists() else "Create"} {name}')
    if dry_run or not changes:
        print(f'{len(changes)} file(s) to update.' if dry_run else 'Already applied.')
        return
    store = HOME / '.workspace-restore'
    store.mkdir(mode=0o700, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix='apply-', dir=store))
    entries = []
    for name, (data, mode) in changes.items():
        target = HOME / name
        old_mode = stat.S_IMODE(target.stat().st_mode) if target.exists() else None
        if old_mode is not None:
            atomic(backup / 'before' / name, target.read_bytes(), 0o600)
        atomic(backup / 'after' / name, data, 0o600)
        entries.append({'path': name, 'existed': old_mode is not None, 'mode': old_mode})
    atomic(backup / 'manifest.json', json_bytes({'home': str(HOME), 'files': entries}), 0o600)
    print(f'Restore point: {backup}', flush=True)
    written = []
    try:
        for entry in entries:
            name = entry['path']
            atomic(HOME / name, *changes[name])
            written.append(entry)
    except BaseException:
        restore(backup, written)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--dry-run', action='store_true')
    modes.add_argument('--rollback', type=Path, metavar='RESTORE_POINT')
    args = parser.parse_args()
    if not HOME.is_dir():
        parser.exit(1, f'Herdr configuration directory does not exist: {HOME}\n')
    if args.dry_run:
        apply(True)
        return
    with (HOME / '.workspace-install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.rollback:
            backup = args.rollback.resolve()
            manifest = read_json(backup / 'manifest.json', {})
            if manifest.get('home') != str(HOME):
                raise ValueError('restore point belongs to another installation')
            restore(backup, manifest['files'], check_current=True)
            print(f'Restored {len(manifest["files"])} file(s).')
        else:
            apply(False)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
