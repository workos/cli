<script lang="ts">
	// Home page with Lucia auth
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<main>
	<h1>Welcome to SvelteKit</h1>

	{#if data.user}
		<p>Hello, {data.user.username}!</p>
		<nav>
			<a href="/dashboard">Dashboard</a> |
			<form method="POST" action="/logout" style="display:inline">
				<button type="submit">Sign out</button>
			</form>
		</nav>
	{:else}
		<p>You are not signed in.</p>
		<a href="/login">Sign in</a>
	{/if}
</main>

<style>
	main {
		padding: 2rem;
		font-family: system-ui, -apple-system, sans-serif;
	}

	h1 {
		color: #333;
	}

	nav {
		margin-top: 1rem;
	}

	a {
		color: #0066cc;
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}

	button {
		background: none;
		border: none;
		color: #0066cc;
		cursor: pointer;
		font-size: inherit;
		padding: 0;
	}
</style>
