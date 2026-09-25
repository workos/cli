import { parse } from '@babel/parser';
import type { Node, Statement, Expression, MemberExpression } from '@babel/types';

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

/**
 * Supported automatic setup contract: a pathname-guarded SDK call at startup
 * (vanilla JS) or in a mount effect (React). Router declarations alone, imported
 * components and click handlers are not proof. No module/import resolution.
 * A static /login.html page can instead call signIn directly at startup.
 * This is source evidence only; browser-flow testing remains a separate step.
 */
export function hasClientSignInBehavior(source: string, path: string, staticPage = false): boolean {
  const scripts = /<script\b/i.test(source)
    ? [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
        .filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes))
        .map(([, , body]) => body)
    : [source];
  return scripts.some((script) => {
    try {
      const program = parse(script, {
        sourceType: 'unambiguous',
        plugins: ['typescript', 'jsx'],
        allowReturnOutsideFunction: true,
      }).program;
      if (staticPage) return startsSignIn(program.body);
      return guardedSignIn(program.body, path) || effectStartsSignIn(program, path);
    } catch {
      // Unparseable or unsupported source must not authorize a dashboard write.
      return false;
    }
  });
}
