import type { ComponentNode } from '../types';

export interface GeneratedCode {
  imports: Set<string>;
  code: string;
}

export function generateCode(root: ComponentNode, nodes: Map<string, ComponentNode>): GeneratedCode {
  const imports = new Set<string>();

  function nodeToJsx(nodeId: string, depth = 0): string {
    const node = nodes.get(nodeId);
    if (!node) return '';

    imports.add(node.type);

    const indentation = '  '.repeat(depth);
    const childrenJsx = node.children.map(childId => nodeToJsx(childId, depth + 1)).filter(Boolean).join('\n');

    const propsPairs = Object.entries(node.props ?? {})
      .filter(([key, value]) => value !== undefined && key !== 'content')
      .map(([key, value]) => typeof value === 'string' ? `${key}="${value}"` : `${key}={${JSON.stringify(value)}}`);

    const propsString = propsPairs.length ? ' ' + propsPairs.join(' ') : '';

    const content = node.props?.content ?? node.props?.children ?? '';

    if (childrenJsx || content) {
      return `${indentation}<${node.type}${propsString}>\n${content ? indentation + '  ' + content + '\n' : ''}${childrenJsx}\n${indentation}</${node.type}>`;
    }
    return `${indentation}<${node.type}${propsString} />`;
  }

  const jsx = nodeToJsx(root.id);
  const importLine = `import { ${Array.from(imports).sort().join(', ')} } from '@mantine/core';`;
  const code = `${importLine}\n\nexport default function VisualBuilderOutput() {\n  return (\n${jsx}\n  );\n}`;

  return { imports, code };
}
