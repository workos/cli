import { parse } from '@babel/parser';
import type { Node, Statement, Expression, MemberExpression, Program } from '@babel/types';
import { posix } from 'node:path';

function propertyName(node: Node | null | undefined): string | undefined {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'StringLiteral') return node.value;
  return undefined;
}

function memberName(node: MemberExpression): string | undefined {
  return node.computed && node.property.type !== 'StringLiteral' ? undefined : propertyName(node.property);
}

function isPathname(node: Node): boolean {
  if (node.type !== 'MemberExpression' || memberName(node) !== 'pathname') return false;
  const location = node.object;
  return (
    (location.type === 'Identifier' && location.name === 'location') ||
    (location.type === 'MemberExpression' &&
      memberName(location) === 'location' &&
      location.object.type === 'Identifier' &&
      location.object.name === 'window')
  );
}

function isSignInCall(node: Node | null | undefined): boolean {
  if (node?.type === 'AwaitExpression' || (node?.type === 'UnaryExpression' && node.operator === 'void')) {
    return isSignInCall(node.argument);
  }
  return (
    node?.type === 'CallExpression' &&
    ((node.callee.type === 'Identifier' && node.callee.name === 'signIn') ||
      (node.callee.type === 'MemberExpression' && memberName(node.callee) === 'signIn'))
  );
}

/** Only directly executed statements, never a button callback or a nested function. */
function startsSignIn(statements: Statement[]): boolean {
  for (const statement of statements) {
    if (statement.type === 'ExpressionStatement' && isSignInCall(statement.expression)) return true;
    if (statement.type === 'ReturnStatement') return isSignInCall(statement.argument);
    if (statement.type === 'ThrowStatement') return false;
  }
  return false;
}

function guardsPath(test: Expression, path: string, aliases: Set<string>): boolean {
  if (test.type === 'LogicalExpression' && test.operator === '&&') {
    if ([test.left, test.right].some((part) => part.type === 'BooleanLiteral' && !part.value)) return false;
    return guardsPath(test.left, path, aliases) || guardsPath(test.right, path, aliases);
  }
  if (test.type !== 'BinaryExpression' || !['===', '=='].includes(test.operator)) return false;
  const match = (value: Node, pathname: Node) =>
    value.type === 'StringLiteral' &&
    value.value === path &&
    (isPathname(pathname) || (pathname.type === 'Identifier' && aliases.has(pathname.name)));
  return match(test.left, test.right) || match(test.right, test.left);
}

/** Route condition and sign-in must be in the same executed branch. */
function guardedSignIn(statements: Statement[], path: string): boolean {
  const aliases = new Set<string>();
  for (const statement of statements) {
    if (statement.type === 'VariableDeclaration' && statement.kind === 'const') {
      for (const declaration of statement.declarations) {
        if (declaration.id.type === 'Identifier' && declaration.init && isPathname(declaration.init)) {
          aliases.add(declaration.id.name);
        }
      }
    }
    if (statement.type === 'IfStatement' && guardsPath(statement.test, path, aliases)) {
      const body = statement.consequent.type === 'BlockStatement' ? statement.consequent.body : [statement.consequent];
      if (startsSignIn(body)) return true;
    }
    if (statement.type === 'ReturnStatement' || statement.type === 'ThrowStatement') return false;
  }
  return false;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}

function effectStartsSignIn(node: Node, path: string): boolean {
  if (node.type === 'CallExpression') {
    const name = node.callee.type === 'MemberExpression' ? memberName(node.callee) : propertyName(node.callee);
    const callback = node.arguments[0];
    if (
      name === 'useEffect' &&
      (callback?.type === 'ArrowFunctionExpression' || callback?.type === 'FunctionExpression') &&
      callback.body.type === 'BlockStatement' &&
      guardedSignIn(callback.body.body, path)
    )
      return true;
  }
  return Object.values(node).some((value) => {
    if (Array.isArray(value)) return value.some((child) => isNode(child) && effectStartsSignIn(child, path));
    return isNode(value) && effectStartsSignIn(value, path);
  });
}

function children(node: Node): Node[] {
  return Object.values(node).flatMap((value) =>
    Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [],
  );
}

type Bindings = Map<string, Node>;

function bindPattern(pattern: Node, value: Node, bindings: Bindings): void {
  if (pattern.type === 'Identifier') bindings.set(pattern.name, value);
  else if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties)
      bindPattern(property.type === 'RestElement' ? property.argument : property.value, value, bindings);
  } else if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements) if (element) bindPattern(element, value, bindings);
  } else if (pattern.type === 'AssignmentPattern') bindPattern(pattern.left, value, bindings);
  else if (pattern.type === 'RestElement') bindPattern(pattern.argument, value, bindings);
}

function scopeBindings(statements: Node[]): Bindings {
  const bindings: Bindings = new Map();
  for (let statement of statements) {
    if (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') {
      if (!statement.declaration) continue;
      statement = statement.declaration;
    }
    if ((statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') && statement.id) {
      bindings.set(statement.id.name, statement);
    } else if (statement.type === 'VariableDeclaration') {
      for (const declaration of statement.declarations) {
        bindPattern(
          declaration.id,
          statement.kind === 'const' && declaration.id.type === 'Identifier' && declaration.init
            ? declaration.init
            : declaration,
          bindings,
        );
      }
    } else if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement.specifiers) bindings.set(specifier.local.name, specifier);
    }
  }
  return bindings;
}

function isFunction(
  node: Node,
): node is Extract<Node, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }> {
  return (
    node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression'
  );
}

/** Only a direct effect in this component, never a nested helper or event callback. */
function componentStartsSignIn(node: Node): boolean {
  if (!isFunction(node) || node.body.type !== 'BlockStatement') return false;
  for (const statement of node.body.body) {
    if (statement.type === 'ReturnStatement' || statement.type === 'ThrowStatement') return false;
    if (statement.type !== 'ExpressionStatement' || statement.expression.type !== 'CallExpression') continue;
    const call = statement.expression;
    const name = call.callee.type === 'MemberExpression' ? memberName(call.callee) : propertyName(call.callee);
    const callback = call.arguments[0];
    if (name !== 'useEffect' || !callback || !isFunction(callback)) continue;
    if (callback.body.type !== 'BlockStatement') {
      if (isSignInCall(callback.body)) return true;
    } else if (effectBodyStartsSignIn(callback.body.body)) return true;
  }
  return false;
}

/** Readiness guards are supported, but arbitrary conditions are not route evidence. */
function effectBodyStartsSignIn(statements: Statement[]): boolean {
  for (const statement of statements) {
    if (statement.type === 'ExpressionStatement' && isSignInCall(statement.expression)) return true;
    if (statement.type === 'ReturnStatement') return isSignInCall(statement.argument);
    if (statement.type === 'ThrowStatement') return false;
    if (statement.type === 'IfStatement') {
      const test = statement.test;
      const body = statement.consequent.type === 'BlockStatement' ? statement.consequent.body : [statement.consequent];
      // Common SDK-ready form: if (isLoading) return; signIn();
      if (
        test.type === 'Identifier' &&
        ['isLoading', 'loading'].includes(test.name) &&
        !statement.alternate &&
        body.length === 1 &&
        body[0].type === 'ReturnStatement' &&
        !body[0].argument
      )
        continue;
      if (
        test.type !== 'UnaryExpression' ||
        test.operator !== '!' ||
        test.argument.type !== 'Identifier' ||
        !['isLoading', 'loading'].includes(test.argument.name)
      )
        return false;
      if (startsSignIn(body)) return true;
      return false;
    }
  }
  return false;
}

function routeComponent(node: Node, path: string): string | undefined {
  const values = new Map<string, Node>();
  if (
    node.type === 'JSXElement' &&
    node.openingElement.name.type === 'JSXIdentifier' &&
    node.openingElement.name.name === 'Route'
  ) {
    for (const attribute of node.openingElement.attributes) {
      if (attribute.type !== 'JSXAttribute' || attribute.name.type !== 'JSXIdentifier' || !attribute.value)
        return undefined;
      if (values.has(attribute.name.name)) return undefined;
      values.set(
        attribute.name.name,
        attribute.value.type === 'JSXExpressionContainer' ? attribute.value.expression : attribute.value,
      );
    }
  } else if (node.type === 'ObjectExpression') {
    for (const property of node.properties) {
      if (property.type !== 'ObjectProperty' || property.computed) return undefined;
      const name = propertyName(property.key);
      if (!name || values.has(name)) return undefined;
      values.set(name, property.value);
    }
  } else return undefined;
  const routePath = values.get('path');
  if (routePath?.type !== 'StringLiteral' || routePath.value !== path) return undefined;
  const targets = ['element', 'Component', 'component'].filter((name) => values.has(name));
  if (targets.length !== 1) return undefined;
  const target = values.get(targets[0])!;
  if (targets[0] !== 'element') return target.type === 'Identifier' ? target.name : undefined;
  if (target.type !== 'JSXElement' || target.openingElement.name.type !== 'JSXIdentifier') return undefined;
  const name = target.openingElement.name.name;
  return /^[A-Z]/.test(name) ? name : undefined;
}

/** Conservatively decline reassigned names, including writes in nested scopes. */
function reassignedNames(node: Node, names: Bindings = new Map()): Bindings {
  if (node.type === 'AssignmentExpression') bindPattern(node.left, node, names);
  if (node.type === 'UpdateExpression') bindPattern(node.argument, node, names);
  for (const child of children(node)) reassignedNames(child, names);
  return names;
}

function exportedComponent(program: Program, name: string): Node | undefined {
  const bindings = scopeBindings(program.body);
  const reassigned = reassignedNames(program);
  for (const local of reassigned.keys()) bindings.delete(local);
  for (const statement of program.body) {
    if (name === 'default' && statement.type === 'ExportDefaultDeclaration') {
      const declaration = statement.declaration;
      if (declaration.type === 'Identifier') return bindings.get(declaration.name);
      if (declaration.type === 'FunctionDeclaration' && declaration.id && reassigned.has(declaration.id.name))
        return undefined;
      return declaration;
    }
    if (statement.type !== 'ExportNamedDeclaration' || statement.source || statement.exportKind === 'type') continue;
    if (statement.declaration) {
      if (scopeBindings([statement.declaration]).has(name)) return bindings.get(name);
    }
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === 'ExportSpecifier' &&
        specifier.exportKind !== 'type' &&
        propertyName(specifier.exported) === name
      )
        return bindings.get(specifier.local.name);
    }
  }
  return undefined;
}

function importedComponent(
  binding: Node,
  program: Program,
  file: string,
  modules: Map<string, Program[]>,
): Node | undefined {
  if (binding.type !== 'ImportSpecifier' && binding.type !== 'ImportDefaultSpecifier') return undefined;
  const declaration = program.body.find(
    (node) => node.type === 'ImportDeclaration' && node.specifiers.includes(binding),
  );
  if (
    declaration?.type !== 'ImportDeclaration' ||
    declaration.importKind === 'type' ||
    (binding.type === 'ImportSpecifier' && binding.importKind === 'type')
  )
    return undefined;
  const source = declaration.source.value;
  if (!source.startsWith('./') && !source.startsWith('../')) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(file), source));
  const extensions = ['.tsx', '.ts', '.jsx', '.js', '.mjs'];
  const candidates = [
    base,
    ...extensions.map((ext) => base + ext),
    ...extensions.map((ext) => `${base}/index${ext}`),
    ...(/\.jsx?$/.test(base) ? [base.replace(/\.jsx?$/, '.ts'), base.replace(/\.jsx?$/, '.tsx')] : []),
  ].filter((candidate) => modules.has(candidate));
  if (candidates.length !== 1) return undefined;
  const programs = modules.get(candidates[0])!;
  if (programs.length !== 1) return undefined;
  return exportedComponent(
    programs[0],
    binding.type === 'ImportDefaultSpecifier' ? 'default' : propertyName(binding.imported)!,
  );
}

/** Hoisted var bindings must also shadow outer components, even inside a nested block. */
function hoistedVars(node: Node, bindings: Bindings): void {
  for (const child of children(node)) {
    if (isFunction(child)) continue;
    if (child.type === 'VariableDeclaration' && child.kind === 'var') {
      for (const declaration of child.declarations) bindPattern(declaration.id, declaration, bindings);
    }
    hoistedVars(child, bindings);
  }
}

/**
 * Tie a literal route target to its lexical component binding and direct effect.
 * This does not prove the router is mounted at runtime. Wrappers, re-exports,
 * namespace imports and computed route targets deliberately remain unsupported.
 */
function mountedRouteStartsSignIn(
  program: Program,
  path: string,
  file: string,
  modules: Map<string, Program[]>,
): boolean {
  const reassigned = reassignedNames(program);
  function visit(node: Node, scopes: Bindings[]): boolean {
    // These scopes/forms are not supported; do not resolve through them by name.
    if (
      node.type === 'ClassDeclaration' ||
      node.type === 'ClassExpression' ||
      node.type === 'ObjectMethod' ||
      node.type === 'TSModuleDeclaration'
    )
      return false;
    if (node.type === 'Program' || node.type === 'BlockStatement') scopes = [...scopes, scopeBindings(node.body)];
    if (isFunction(node)) {
      const parameters: Bindings = new Map();
      if (node.type === 'FunctionExpression' && node.id) parameters.set(node.id.name, node);
      for (const parameter of node.params) bindPattern(parameter, parameter, parameters);
      hoistedVars(node.body, parameters);
      scopes = [...scopes, parameters];
    }
    if (node.type === 'CatchClause' && node.param) {
      const bindings: Bindings = new Map();
      bindPattern(node.param, node.param, bindings);
      scopes = [...scopes, bindings];
    }
    if (node.type === 'ForStatement' && node.init?.type === 'VariableDeclaration')
      scopes = [...scopes, scopeBindings([node.init])];
    if ((node.type === 'ForInStatement' || node.type === 'ForOfStatement') && node.left.type === 'VariableDeclaration')
      scopes = [...scopes, scopeBindings([node.left])];
    if (node.type === 'SwitchStatement')
      scopes = [...scopes, scopeBindings(node.cases.flatMap((branch) => branch.consequent))];
    const name = routeComponent(node, path);
    if (name && !reassigned.has(name)) {
      const binding = [...scopes]
        .reverse()
        .find((scope) => scope.has(name))
        ?.get(name);
      if (binding && componentStartsSignIn(importedComponent(binding, program, file, modules) ?? binding)) return true;
    }
    return children(node).some((child) => visit(child, scopes));
  }
  return visit(program, []);
}

export interface ClientSource {
  file: string;
  content: string;
}

function parsePrograms(source: string): Program[] {
  const scripts = /<script\b/i.test(source)
    ? [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
        .filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes))
        .map(([, , body]) => body)
    : [source];
  return scripts.flatMap((script) => {
    try {
      return [
        parse(script, {
          sourceType: 'unambiguous',
          plugins: ['typescript', 'jsx'],
          allowReturnOutsideFunction: true,
        }).program,
      ];
    } catch {
      // Unparseable or unsupported source must not authorize a dashboard write.
      return [];
    }
  });
}

/** Source evidence only; browser-flow testing remains a separate step. */
export function hasClientSignInBehavior(source: string, path: string, staticPage = false): boolean {
  return hasClientSignInBehaviorInSources([{ file: '', content: source }], path, staticPage);
}

/** Imports resolve only against these already bounded records, never additional disk reads. */
export function hasClientSignInBehaviorInSources(sources: ClientSource[], path: string, staticPage = false): boolean {
  const modules = new Map(sources.map(({ file, content }) => [file, parsePrograms(content)]));
  for (const [file, programs] of modules) {
    for (const program of programs) {
      if (
        staticPage
          ? startsSignIn(program.body)
          : guardedSignIn(program.body, path) ||
            effectStartsSignIn(program, path) ||
            mountedRouteStartsSignIn(program, path, file, modules)
      )
        return true;
    }
  }
  return false;
}
