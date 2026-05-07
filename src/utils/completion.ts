/**
 * Shell completion engine for `workos completion <shell>` and the hidden
 * `workos --get-yargs-completions` handler.
 *
 * Walks the static command registry from help-json.ts to produce completions.
 * Shell scripts call `workos --get-yargs-completions <args...>` and parse
 * the tab-separated output.
 */

import { commandRegistry, globalOptionRegistry, type CommandSchema, type OptionSchema } from './help-json.js';

const NO_FILE_COMP = 4;

interface Completion {
  name: string;
  description: string;
}

interface CompletionResult {
  completions: Completion[];
  directive: number;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function completeHandler(args: string[]): void {
  const result = generateCompletions(args);
  for (const c of result.completions) {
    process.stdout.write(`${c.name}\t${c.description}\n`);
  }
  process.stdout.write(`:${result.directive}\n`);
}

export function generateCompletions(args: string[]): CompletionResult {
  const partial = args.at(-1) ?? '';
  const preceding = args.slice(0, -1);
  const normalized = getNormalizedCommands();

  const { command, usedOptions } = walkCommandTree(normalized, globalOptionRegistry, preceding);

  if (partial.startsWith('-')) {
    return noFileComp(completeOptions(command, globalOptionRegistry, partial, usedOptions));
  }

  const completions = [
    ...completeSubcommands(command, normalized, partial),
    ...completeOptions(command, globalOptionRegistry, '', usedOptions),
  ];
  return noFileComp(completions);
}

// ── Registry normalization ───────────────────────────────────────────────────

/**
 * The help-json registry mixes two styles:
 *   - Nested: { name: 'skills', commands: [{ name: 'install', ... }] }
 *   - Flat compound: { name: 'auth login', ... }, { name: 'auth logout', ... }
 *
 * Normalize flat compound entries into virtual parents with children.
 */
function normalizeRegistry(commands: CommandSchema[]): CommandSchema[] {
  const byPrefix = new Map<string, CommandSchema[]>();
  const result: CommandSchema[] = [];
  const seen = new Set<string>();

  for (const cmd of commands) {
    const spaceIdx = cmd.name.indexOf(' ');
    if (spaceIdx === -1) {
      result.push(cloneCommand(cmd));
      seen.add(cmd.name);
    } else {
      const prefix = cmd.name.slice(0, spaceIdx);
      const rest = cmd.name.slice(spaceIdx + 1);
      let group = byPrefix.get(prefix);
      if (!group) {
        group = [];
        byPrefix.set(prefix, group);
      }
      group.push({ ...cmd, name: rest });
    }
  }

  for (const [prefix, children] of byPrefix) {
    if (seen.has(prefix)) {
      const index = result.findIndex((c) => c.name === prefix);
      const existing = result[index]!;
      result[index] = {
        ...existing,
        commands: [...(existing.commands ?? []), ...normalizeRegistry(children)],
      };
    } else {
      result.push({
        name: prefix,
        description: children[0]?.description ?? '',
        commands: normalizeRegistry(children),
      });
    }
  }

  return result;
}

function cloneCommand(command: CommandSchema): CommandSchema {
  return {
    ...command,
    ...(command.commands ? { commands: normalizeRegistry(command.commands) } : {}),
  };
}

let cachedNormalized: CommandSchema[] | null = null;

function getNormalizedCommands(): CommandSchema[] {
  if (!cachedNormalized) {
    cachedNormalized = normalizeRegistry(commandRegistry);
  }
  return cachedNormalized;
}

// ── Tree walking ─────────────────────────────────────────────────────────────

function walkCommandTree(
  commands: CommandSchema[],
  globalOptions: OptionSchema[],
  words: string[],
): { command: CommandSchema | null; usedOptions: Set<string> } {
  let current: CommandSchema | null = null;
  let currentCommands = commands;
  const usedOptions = new Set<string>();
  let i = 0;

  while (i < words.length) {
    const word = words[i]!;

    const sub = currentCommands.find((c) => c.name === word);
    if (sub) {
      current = sub;
      currentCommands = sub.commands ?? [];
      i += 1;
      continue;
    }

    if (word.startsWith('-')) {
      usedOptions.add(word);
      const opt = findOption(current, globalOptions, word);
      i += opt && optionTakesValue(opt) ? 2 : 1;
      continue;
    }

    i += 1;
  }

  return { command: current, usedOptions };
}

// ── Completion generators ────────────────────────────────────────────────────

function completeSubcommands(command: CommandSchema | null, topLevel: CommandSchema[], partial: string): Completion[] {
  const subs = command ? (command.commands ?? []) : topLevel;
  return subs.filter((c) => c.name.startsWith(partial)).map((c) => ({ name: c.name, description: c.description }));
}

function completeOptions(
  command: CommandSchema | null,
  globalOptions: OptionSchema[],
  partial: string,
  usedOptions: Set<string>,
): Completion[] {
  const opts = [...(command?.options ?? []), ...globalOptions];
  const completions: Completion[] = [];

  for (const opt of opts) {
    if (opt.hidden) continue;
    const flag = `--${opt.name}`;
    if (usedOptions.has(flag)) continue;
    if (!flag.startsWith(partial)) continue;
    completions.push({ name: flag, description: opt.description });
  }

  return completions;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findOption(
  command: CommandSchema | null,
  globalOptions: OptionSchema[],
  flag: string,
): OptionSchema | undefined {
  const name = flag.replace(/^--?/, '');
  const opts = [...(command?.options ?? []), ...globalOptions];
  return opts.find((o) => o.name === name || o.alias === name);
}

function optionTakesValue(opt: OptionSchema): boolean {
  return opt.type !== 'boolean';
}

function noFileComp(completions: Completion[]): CompletionResult {
  return { completions, directive: NO_FILE_COMP };
}

// ── Shell script generators ──────────────────────────────────────────────────

export const SUPPORTED_SHELLS = ['bash', 'zsh', 'fish', 'powershell'] as const;
export type SupportedShell = (typeof SUPPORTED_SHELLS)[number];

const GENERATORS: Record<SupportedShell, (bin: string) => string> = {
  bash: generateBash,
  zsh: generateZsh,
  fish: generateFish,
  powershell: generatePowershell,
};

export function generateShellScript(shell: string, binaryName: string): string {
  if (!isSupportedShell(shell)) {
    throw new Error(`Unsupported shell: ${shell}. Supported: ${SUPPORTED_SHELLS.join(', ')}`);
  }
  return GENERATORS[shell](binaryName);
}

function isSupportedShell(shell: string): shell is SupportedShell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(shell);
}

function generateBash(bin: string): string {
  return `# Bash completion for ${bin}
# Add to ~/.bashrc:
#   eval "$(${bin} completion bash)"
# Or save to a file:
#   ${bin} completion bash > /etc/bash_completion.d/${bin}

_${bin}_completions() {
    local cur prev words cword
    _init_completion -n = 2>/dev/null || {
        cur="\${COMP_WORDS[COMP_CWORD]}"
        prev="\${COMP_WORDS[COMP_CWORD-1]}"
        words=("\${COMP_WORDS[@]}")
        cword=$COMP_CWORD
    }

    local IFS=$'\\n'
    local output
    output=$("${bin}" --get-yargs-completions "\${COMP_WORDS[@]:1}" 2>/dev/null)
    local rc=$?
    if [ $rc -ne 0 ]; then
        return
    fi

    local directive
    directive=$(printf '%s\n' "$output" | tail -n1 | tr -d ':')
    output=$(printf '%s\n' "$output" | sed '$d')

    local -a completions
    while IFS=$'\\t' read -r comp _desc; do
        [ -n "$comp" ] && completions+=("$comp")
    done <<< "$output"

    COMPREPLY=($(compgen -W "\${completions[*]}" -- "$cur"))

    if (( directive & 4 )); then
        compopt +o default 2>/dev/null
    fi
}

complete -o default -F _${bin}_completions ${bin}
`;
}

function generateZsh(bin: string): string {
  const tab = "$'\\t'";
  return `#compdef ${bin}
# Zsh completion for ${bin}
# Add to ~/.zshrc:
#   eval "$(${bin} completion zsh)"
# Or save to a file in your $fpath:
#   mkdir -p ~/.zfunc
#   ${bin} completion zsh > ~/.zfunc/_${bin}
#   # Then add to ~/.zshrc:
#   #   fpath=(~/.zfunc $fpath)
#   #   autoload -Uz compinit && compinit

_${bin}() {
    local -a completions
    local directive output

    output=("\${(@f)$( ${bin} --get-yargs-completions "\${words[@]:1}" 2>/dev/null)}")
    if (( \${#output} == 0 )); then
        return
    fi

    directive="\${output[-1]#:}"
    output=("\${output[@]:0:$(("\${#output[@]}-1"))}")

    local -a candidates
    for line in "\${output[@]}"; do
        if [[ -z "$line" ]]; then
            continue
        fi
        local comp="\${line%%${tab}*}"
        local desc="\${line#*${tab}}"
        if [[ "$comp" == "$desc" ]]; then
            candidates+=("$comp")
        else
            desc="\${desc//:/\\:}"
            candidates+=("$comp:$desc")
        fi
    done

    _describe '${bin}' candidates

    if (( !(directive & 4) )); then
        _files
    fi
}

compdef _${bin} ${bin}
`;
}

function generateFish(bin: string): string {
  return `# Fish completion for ${bin}
# Save to:
#   mkdir -p ~/.config/fish/completions
#   ${bin} completion fish > ~/.config/fish/completions/${bin}.fish

function __${bin}_complete
    set -l tokens (commandline -opc)
    set -l current (commandline -ct)

    set -l args $tokens[2..]
    set -l output (${bin} --get-yargs-completions $args $current 2>/dev/null)

    if test $status -ne 0
        return
    end

    set -l count (count $output)
    if test $count -le 1
        return
    end

    for i in (seq 1 (math $count - 1))
        echo $output[$i]
    end
end

complete -c ${bin} -f -a '(__${bin}_complete)'
`;
}

function generatePowershell(bin: string): string {
  return `# PowerShell completion for ${bin}
# Add to your $PROFILE:
#   ${bin} completion powershell | Out-String | Invoke-Expression

Register-ArgumentCompleter -Native -CommandName ${bin} -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $words = $commandAst.ToString().Split(' ', [StringSplitOptions]::RemoveEmptyEntries)
    $args = @()
    if ($words.Count -gt 1) {
        $args = $words[1..($words.Count - 1)]
    }
    $args += $wordToComplete

    $output = & "${bin}" --get-yargs-completions @args 2>$null
    if (-not $output) { return }

    $lines = $output -split "\\n"
    $directive = 0
    $completions = @()
    foreach ($line in $lines) {
        if ($line -match '^:(\\d+)$') {
            $directive = [int]$matches[1]
        } elseif ($line.Trim()) {
            $parts = $line.Split("\`t", 2)
            $comp = $parts[0]
            $desc = if ($parts.Count -gt 1) { $parts[1] } else { '' }
            $completions += [System.Management.Automation.CompletionResult]::new(
                $comp, $comp, 'ParameterValue', $desc
            )
        }
    }

    $completions
}
`;
}
