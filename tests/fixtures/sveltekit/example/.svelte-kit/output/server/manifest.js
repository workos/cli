export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.T22yjXU7.js",app:"_app/immutable/entry/app.CpUzidFU.js",imports:["_app/immutable/entry/start.T22yjXU7.js","_app/immutable/chunks/BShzwfeu.js","_app/immutable/chunks/B_PiQ68N.js","_app/immutable/chunks/CE0Ev3WY.js","_app/immutable/entry/app.CpUzidFU.js","_app/immutable/chunks/B_PiQ68N.js","_app/immutable/chunks/jjmyhcpZ.js","_app/immutable/chunks/C8WMVNin.js","_app/immutable/chunks/CE0Ev3WY.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
