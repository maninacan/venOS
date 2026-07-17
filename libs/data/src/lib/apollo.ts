import { ApolloClient, InMemoryCache, createHttpLink, from } from '@apollo/client/core';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { supabase } from './supabase';
import { showToast } from './useToast';

const API_URL = import.meta.env['VITE_API_URL'] as string ?? 'http://localhost:3000';

const httpLink = createHttpLink({
  uri: `${API_URL}/graphql`,
});

const authLink = setContext(async (_, { headers }) => {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  return {
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  };
});

const errorLink = onError(({ graphQLErrors, networkError, operation }) => {
  if (graphQLErrors) {
    graphQLErrors.forEach(({ message, locations, path }) =>
      console.error(`[GraphQL][${operation.operationName}] ${message}`, { locations, path })
    );
  }
  if (networkError) {
    console.error(`[Network][${operation.operationName}]`, networkError);
    const status = (networkError as { statusCode?: number }).statusCode;
    if (status === 401) {
      showToast('Your session expired. Please sign in again.', 'warning');
    } else {
      showToast('Network error — please check your connection.', 'error');
    }
  }
});

export const apolloClient = new ApolloClient({
  link: from([errorLink, authLink, httpLink]),
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network' },
  },
});
