import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from './TextInput.js';

interface CredentialsFormProps {
  requiresApiKey: boolean;
  onSubmit: (credentials: { apiKey: string; clientId: string }) => void;
}

type Field = 'apiKey' | 'clientId';

export function CredentialsForm({ requiresApiKey, onSubmit }: CredentialsFormProps): React.ReactElement {
  const [apiKey, setApiKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [focusedField, setFocusedField] = useState<Field>(requiresApiKey ? 'apiKey' : 'clientId');
  const [errors, setErrors] = useState<{ apiKey?: string; clientId?: string }>({});

  const validate = (): boolean => {
    const newErrors: { apiKey?: string; clientId?: string } = {};

    if (requiresApiKey && !apiKey) {
      newErrors.apiKey = 'API Key is required';
    } else if (requiresApiKey && !apiKey.startsWith('sk_')) {
      newErrors.apiKey = 'API Key should start with sk_';
    }

    if (!clientId) {
      newErrors.clientId = 'Client ID is required';
    } else if (!clientId.startsWith('client_')) {
      newErrors.clientId = 'Client ID should start with client_';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) {
      onSubmit({ apiKey, clientId });
    }
  };

  // Tab/arrows to switch fields
  useInput((input, key) => {
    if (key.tab || key.downArrow) {
      if (requiresApiKey) {
        setFocusedField((prev) => (prev === 'apiKey' ? 'clientId' : 'apiKey'));
      }
    } else if (key.upArrow) {
      if (requiresApiKey) {
        setFocusedField((prev) => (prev === 'clientId' ? 'apiKey' : 'clientId'));
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Enter your WorkOS credentials
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>Get them from https://dashboard.workos.com</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {requiresApiKey && (
          <Box marginBottom={1}>
            <TextInput
              label="API Key"
              placeholder="sk_..."
              mask={true}
              value={apiKey}
              onChange={setApiKey}
              onSubmit={() => setFocusedField('clientId')}
              focused={focusedField === 'apiKey'}
              error={errors.apiKey}
            />
          </Box>
        )}

        <Box marginBottom={1}>
          <TextInput
            label="Client ID"
            placeholder="client_..."
            value={clientId}
            onChange={setClientId}
            onSubmit={handleSubmit}
            focused={focusedField === 'clientId'}
            error={errors.clientId}
          />
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{requiresApiKey ? 'Tab: switch fields | ' : ''}Ctrl+U: clear | Enter: continue</Text>
      </Box>
    </Box>
  );
}
