<script lang="ts">
	// Protected dashboard page — requires Lucia session
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<main>
	{#if data.user}
		<h1>Dashboard</h1>
		<p>Welcome, {data.user.username}!</p>
		<form method="POST" action="/logout">
			<button type="submit">Sign Out</button>
		</form>
	{:else}
		<p>You must be signed in to view this page.</p>
		<a href="/login">Sign in</a>
	{/if}
	<p><a href="/">Back to home</a></p>
</main>

<style>
	main {
		padding: 2rem;
		font-family: system-ui, -apple-system, sans-serif;
	}

	a {
		color: #0066cc;
		text-decoration: none;
	}
</style>
