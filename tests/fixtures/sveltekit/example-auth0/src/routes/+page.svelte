<script lang="ts">
	// Auth0-powered home page — agent should migrate to WorkOS AuthKit
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<main>
	<h1>Welcome to SvelteKit</h1>

	{#if data.user}
		<p>Hello, {data.user.name}!</p>
		<a href="/logout">Sign out</a>
	{:else}
		<p>You are not signed in.</p>
		<a href="/login">Sign in with Auth0</a>
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

	a {
		color: #0066cc;
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}
</style>
