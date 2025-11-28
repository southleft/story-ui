/**
 * Component Registry
 *
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 * This file is generated at build time by story-ui
 *
 * It exports all components from your component library
 * for use in the live preview renderer.
 *
 * NOTE: This is a sample/placeholder registry for development.
 * When you run `story-ui deploy`, this file will be regenerated
 * with your actual component library imports.
 */

import React from 'react';

// Sample placeholder components for development/testing
// These will be replaced with actual component imports from your library

const PlaceholderButton: React.FC<{
  children?: React.ReactNode;
  variant?: 'filled' | 'outline' | 'subtle' | 'light';
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
  onClick?: () => void;
}> = ({ children, variant = 'filled', color = '#6366f1', size = 'md', disabled, onClick }) => {
  const sizes = {
    xs: { padding: '4px 8px', fontSize: '11px' },
    sm: { padding: '6px 12px', fontSize: '12px' },
    md: { padding: '8px 16px', fontSize: '14px' },
    lg: { padding: '10px 20px', fontSize: '16px' },
    xl: { padding: '12px 24px', fontSize: '18px' },
  };

  const baseStyles: React.CSSProperties = {
    ...sizes[size],
    borderRadius: '6px',
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'all 150ms ease',
    border: 'none',
    fontFamily: 'inherit',
  };

  const variantStyles: Record<string, React.CSSProperties> = {
    filled: { backgroundColor: color, color: 'white' },
    outline: { backgroundColor: 'transparent', border: `1px solid ${color}`, color },
    subtle: { backgroundColor: `${color}20`, color },
    light: { backgroundColor: `${color}15`, color },
  };

  return (
    <button
      style={{ ...baseStyles, ...variantStyles[variant] }}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

const PlaceholderCard: React.FC<{
  children?: React.ReactNode;
  shadow?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  padding?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  radius?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  withBorder?: boolean;
}> = ({ children, shadow = 'sm', padding = 'md', radius = 'md', withBorder = false }) => {
  const paddings = { xs: '8px', sm: '12px', md: '16px', lg: '24px', xl: '32px' };
  const radii = { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' };
  const shadows = {
    xs: '0 1px 2px rgba(0,0,0,0.05)',
    sm: '0 1px 3px rgba(0,0,0,0.1)',
    md: '0 4px 6px rgba(0,0,0,0.1)',
    lg: '0 10px 15px rgba(0,0,0,0.1)',
    xl: '0 20px 25px rgba(0,0,0,0.15)',
  };

  return (
    <div
      style={{
        backgroundColor: '#1e1e1e',
        padding: paddings[padding],
        borderRadius: radii[radius],
        boxShadow: shadows[shadow],
        border: withBorder ? '1px solid #27272a' : 'none',
      }}
    >
      {children}
    </div>
  );
};

const PlaceholderText: React.FC<{
  children?: React.ReactNode;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  weight?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
}> = ({ children, size = 'md', weight = 400, color, align = 'left' }) => {
  const sizes = { xs: '11px', sm: '13px', md: '14px', lg: '16px', xl: '18px' };

  return (
    <p
      style={{
        fontSize: sizes[size],
        fontWeight: weight,
        color: color || '#fafafa',
        textAlign: align,
        margin: 0,
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
};

const PlaceholderTitle: React.FC<{
  children?: React.ReactNode;
  order?: 1 | 2 | 3 | 4 | 5 | 6;
  color?: string;
  align?: 'left' | 'center' | 'right';
}> = ({ children, order = 1, color, align = 'left' }) => {
  const sizes = {
    1: '32px',
    2: '28px',
    3: '24px',
    4: '20px',
    5: '18px',
    6: '16px',
  };

  const Tag = `h${order}` as keyof JSX.IntrinsicElements;

  return (
    <Tag
      style={{
        fontSize: sizes[order],
        fontWeight: 700,
        color: color || '#fafafa',
        textAlign: align,
        margin: 0,
        lineHeight: 1.25,
      }}
    >
      {children}
    </Tag>
  );
};

const PlaceholderStack: React.FC<{
  children?: React.ReactNode;
  spacing?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  align?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
}> = ({ children, spacing = 'md', align = 'stretch' }) => {
  const spacings = { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: spacings[spacing],
        alignItems: align,
      }}
    >
      {children}
    </div>
  );
};

const PlaceholderGroup: React.FC<{
  children?: React.ReactNode;
  spacing?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around';
  align?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
  wrap?: 'wrap' | 'nowrap';
}> = ({ children, spacing = 'md', justify = 'flex-start', align = 'center', wrap = 'wrap' }) => {
  const spacings = { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: spacings[spacing],
        justifyContent: justify,
        alignItems: align,
        flexWrap: wrap,
      }}
    >
      {children}
    </div>
  );
};

const PlaceholderBadge: React.FC<{
  children?: React.ReactNode;
  color?: string;
  variant?: 'filled' | 'outline' | 'light';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}> = ({ children, color = '#6366f1', variant = 'light', size = 'md' }) => {
  const sizes = {
    xs: { padding: '2px 6px', fontSize: '10px' },
    sm: { padding: '3px 8px', fontSize: '11px' },
    md: { padding: '4px 10px', fontSize: '12px' },
    lg: { padding: '5px 12px', fontSize: '13px' },
    xl: { padding: '6px 14px', fontSize: '14px' },
  };

  const variantStyles: Record<string, React.CSSProperties> = {
    filled: { backgroundColor: color, color: 'white' },
    outline: { backgroundColor: 'transparent', border: `1px solid ${color}`, color },
    light: { backgroundColor: `${color}20`, color },
  };

  return (
    <span
      style={{
        ...sizes[size],
        ...variantStyles[variant],
        borderRadius: '9999px',
        fontWeight: 500,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </span>
  );
};

const PlaceholderTextInput: React.FC<{
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  error?: string;
  description?: string;
}> = ({ label, placeholder, value, onChange, disabled, error, description }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {label && (
        <label style={{ fontSize: '14px', fontWeight: 500, color: '#fafafa' }}>
          {label}
        </label>
      )}
      {description && (
        <span style={{ fontSize: '12px', color: '#71717a' }}>{description}</span>
      )}
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        style={{
          padding: '8px 12px',
          fontSize: '14px',
          borderRadius: '6px',
          border: `1px solid ${error ? '#ef4444' : '#27272a'}`,
          backgroundColor: '#1a1a1a',
          color: '#fafafa',
          outline: 'none',
          opacity: disabled ? 0.5 : 1,
        }}
      />
      {error && <span style={{ fontSize: '12px', color: '#ef4444' }}>{error}</span>}
    </div>
  );
};

// Component registry - maps component names to their implementations
// This will be replaced with actual component imports at build time
export const componentRegistry: Record<string, React.ComponentType<any>> = {
  Button: PlaceholderButton,
  Card: PlaceholderCard,
  Text: PlaceholderText,
  Title: PlaceholderTitle,
  Stack: PlaceholderStack,
  Group: PlaceholderGroup,
  Badge: PlaceholderBadge,
  TextInput: PlaceholderTextInput,
};

// List of available component names
export const availableComponents = [
  'Button',
  'Card',
  'Text',
  'Title',
  'Stack',
  'Group',
  'Badge',
  'TextInput',
];

// Export React for use in compiled code
export { React };

// Helper to get a component by name
export function getComponent(name: string): React.ComponentType<any> | undefined {
  return componentRegistry[name];
}

// Check if a component exists
export function hasComponent(name: string): boolean {
  return name in componentRegistry;
}
