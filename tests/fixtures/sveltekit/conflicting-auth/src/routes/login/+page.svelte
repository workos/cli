<script lang="ts">
	// Lucia login form
</script>

<main>
	<h1>Sign In</h1>
	<form method="POST">
		<label>
			Username
			<input name="username" type="text" required />
		</label>
		<label>
			Password
			<input name="password" type="password" required />
		</label>
		<button type="submit">Sign In</button>
	</form>
	<p><a href="/">Back to home</a></p>
</main>

<style>
	main {
		padding: 2rem;
		font-family: system-ui, -apple-system, sans-serif;
	}

	label {
		display: block;
		margin-bottom: 1rem;
	}

	input {
		display: block;
		margin-top: 0.25rem;
		padding: 0.5rem;
	}

	button {
		padding: 0.5rem 1rem;
		cursor: pointer;
	}
</style>
