
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * Environment variables [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env`. Like [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), this module cannot be imported into client-side code. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * _Unlike_ [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), the values exported from this module are statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * ```ts
 * import { API_KEY } from '$env/static/private';
 * ```
 * 
 * Note that all environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * 
 * ```
 * MY_FEATURE_FLAG=""
 * ```
 * 
 * You can override `.env` values from the command line like so:
 * 
 * ```sh
 * MY_FEATURE_FLAG="enabled" npm run dev
 * ```
 */
declare module '$env/static/private' {
	export const MANPATH: string;
	export const GHOSTTY_RESOURCES_DIR: string;
	export const LESS_TERMCAP_mb: string;
	export const NIX_PROFILES: string;
	export const NoDefaultCurrentDirectoryInExePath: string;
	export const TERM_PROGRAM: string;
	export const CLAUDE_CODE_ENTRYPOINT: string;
	export const FNM_LOGLEVEL: string;
	export const LESS_TERMCAP_md: string;
	export const LESS_TERMCAP_me: string;
	export const PYENV_ROOT: string;
	export const SHELL: string;
	export const TERM: string;
	export const FNM_NODE_DIST_MIRROR: string;
	export const HOMEBREW_REPOSITORY: string;
	export const LESS_TERMCAP_mh: string;
	export const RIPGREP_CONFIG_PATH: string;
	export const TMPDIR: string;
	export const TERM_PROGRAM_VERSION: string;
	export const ZDOTDIR: string;
	export const LESS_TERMCAP_ue: string;
	export const PNPM_HOME: string;
	export const ZSH: string;
	export const FNM_COREPACK_ENABLED: string;
	export const GIT_EDITOR: string;
	export const USER: string;
	export const LESS_TERMCAP_mr: string;
	export const COMMAND_MODE: string;
	export const OPENAI_API_KEY: string;
	export const MANROFFOPT: string;
	export const RPROMPT: string;
	export const CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: string;
	export const SSH_AUTH_SOCK: string;
	export const CALENDLY_API_KEY: string;
	export const CODE_DIR: string;
	export const __CF_USER_TEXT_ENCODING: string;
	export const FZF_DEFAULT_OPTS: string;
	export const DOTFILES: string;
	export const TMUX: string;
	export const npm_config_verify_deps_before_run: string;
	export const CACHEDIR: string;
	export const FNM_VERSION_FILE_STRATEGY: string;
	export const LESS_TERMCAP_us: string;
	export const FNM_ARCH: string;
	export const GOOGLE_API_KEY: string;
	export const PATH: string;
	export const GHOSTTY_SHELL_FEATURES: string;
	export const LaunchInstanceID: string;
	export const ZPLUGDIR: string;
	export const __CFBundleIdentifier: string;
	export const npm_command: string;
	export const CONTEXT7_API_KEY: string;
	export const PWD: string;
	export const EDITOR: string;
	export const PERPLEXITY_API_KEY: string;
	export const OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: string;
	export const LANG: string;
	export const NODE_PATH: string;
	export const KEYTIMEOUT: string;
	export const VIM_TMP: string;
	export const FNM_MULTISHELL_PATH: string;
	export const TMUX_PANE: string;
	export const XPC_FLAGS: string;
	export const NIX_SSL_CERT_FILE: string;
	export const ANTHROPIC_API_KEY: string;
	export const RBENV_SHELL: string;
	export const pnpm_config_verify_deps_before_run: string;
	export const XPC_SERVICE_NAME: string;
	export const HOME: string;
	export const PYENV_SHELL: string;
	export const SHLVL: string;
	export const TERMINFO: string;
	export const XDG_CONFIG_HOME: string;
	export const CLAUDE_CODE_TASK_LIST_ID: string;
	export const HOMEBREW_PREFIX: string;
	export const FNM_DIR: string;
	export const PROMPT: string;
	export const LOGNAME: string;
	export const PNPM_PACKAGE_NAME: string;
	export const FZF_CTRL_T_COMMAND: string;
	export const LESS_TERMCAP_so: string;
	export const XDG_DATA_DIRS: string;
	export const FZF_DEFAULT_COMMAND: string;
	export const GHOSTTY_BIN_DIR: string;
	export const COREPACK_ENABLE_AUTO_PIN: string;
	export const npm_config_user_agent: string;
	export const FNM_RESOLVE_ENGINES: string;
	export const HOMEBREW_CELLAR: string;
	export const INFOPATH: string;
	export const REPORTTIME: string;
	export const GITHUB_PERSONAL_ACCESS_TOKEN: string;
	export const OSLogRateLimit: string;
	export const GROK_API_KEY: string;
	export const NIA_API_KEY: string;
	export const SECURITYSESSIONID: string;
	export const CLAUDECODE: string;
	export const NODE_EXTRA_CA_CERTS: string;
	export const COLORTERM: string;
	export const LESS_TERMCAP_se: string;
	export const NODE_ENV: string;
}

/**
 * Similar to [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private), except that it only includes environment variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Values are replaced statically at build time.
 * 
 * ```ts
 * import { PUBLIC_BASE_URL } from '$env/static/public';
 * ```
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to runtime environment variables, as defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * This module cannot be imported into client-side code.
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * console.log(env.DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` always includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 */
declare module '$env/dynamic/private' {
	export const env: {
		MANPATH: string;
		GHOSTTY_RESOURCES_DIR: string;
		LESS_TERMCAP_mb: string;
		NIX_PROFILES: string;
		NoDefaultCurrentDirectoryInExePath: string;
		TERM_PROGRAM: string;
		CLAUDE_CODE_ENTRYPOINT: string;
		FNM_LOGLEVEL: string;
		LESS_TERMCAP_md: string;
		LESS_TERMCAP_me: string;
		PYENV_ROOT: string;
		SHELL: string;
		TERM: string;
		FNM_NODE_DIST_MIRROR: string;
		HOMEBREW_REPOSITORY: string;
		LESS_TERMCAP_mh: string;
		RIPGREP_CONFIG_PATH: string;
		TMPDIR: string;
		TERM_PROGRAM_VERSION: string;
		ZDOTDIR: string;
		LESS_TERMCAP_ue: string;
		PNPM_HOME: string;
		ZSH: string;
		FNM_COREPACK_ENABLED: string;
		GIT_EDITOR: string;
		USER: string;
		LESS_TERMCAP_mr: string;
		COMMAND_MODE: string;
		OPENAI_API_KEY: string;
		MANROFFOPT: string;
		RPROMPT: string;
		CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: string;
		SSH_AUTH_SOCK: string;
		CALENDLY_API_KEY: string;
		CODE_DIR: string;
		__CF_USER_TEXT_ENCODING: string;
		FZF_DEFAULT_OPTS: string;
		DOTFILES: string;
		TMUX: string;
		npm_config_verify_deps_before_run: string;
		CACHEDIR: string;
		FNM_VERSION_FILE_STRATEGY: string;
		LESS_TERMCAP_us: string;
		FNM_ARCH: string;
		GOOGLE_API_KEY: string;
		PATH: string;
		GHOSTTY_SHELL_FEATURES: string;
		LaunchInstanceID: string;
		ZPLUGDIR: string;
		__CFBundleIdentifier: string;
		npm_command: string;
		CONTEXT7_API_KEY: string;
		PWD: string;
		EDITOR: string;
		PERPLEXITY_API_KEY: string;
		OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: string;
		LANG: string;
		NODE_PATH: string;
		KEYTIMEOUT: string;
		VIM_TMP: string;
		FNM_MULTISHELL_PATH: string;
		TMUX_PANE: string;
		XPC_FLAGS: string;
		NIX_SSL_CERT_FILE: string;
		ANTHROPIC_API_KEY: string;
		RBENV_SHELL: string;
		pnpm_config_verify_deps_before_run: string;
		XPC_SERVICE_NAME: string;
		HOME: string;
		PYENV_SHELL: string;
		SHLVL: string;
		TERMINFO: string;
		XDG_CONFIG_HOME: string;
		CLAUDE_CODE_TASK_LIST_ID: string;
		HOMEBREW_PREFIX: string;
		FNM_DIR: string;
		PROMPT: string;
		LOGNAME: string;
		PNPM_PACKAGE_NAME: string;
		FZF_CTRL_T_COMMAND: string;
		LESS_TERMCAP_so: string;
		XDG_DATA_DIRS: string;
		FZF_DEFAULT_COMMAND: string;
		GHOSTTY_BIN_DIR: string;
		COREPACK_ENABLE_AUTO_PIN: string;
		npm_config_user_agent: string;
		FNM_RESOLVE_ENGINES: string;
		HOMEBREW_CELLAR: string;
		INFOPATH: string;
		REPORTTIME: string;
		GITHUB_PERSONAL_ACCESS_TOKEN: string;
		OSLogRateLimit: string;
		GROK_API_KEY: string;
		NIA_API_KEY: string;
		SECURITYSESSIONID: string;
		CLAUDECODE: string;
		NODE_EXTRA_CA_CERTS: string;
		COLORTERM: string;
		LESS_TERMCAP_se: string;
		NODE_ENV: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * Similar to [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), but only includes variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Note that public dynamic environment variables must all be sent from the server to the client, causing larger network requests — when possible, use `$env/static/public` instead.
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.PUBLIC_DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
