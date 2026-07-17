import { RouterProvider } from 'react-router-dom';
import { ApolloProvider } from '@apollo/client/react';
import { apolloClient } from '@org/data';
import { router } from './router';

export function App() {
  return (
    <ApolloProvider client={apolloClient}>
      <RouterProvider router={router} />
    </ApolloProvider>
  );
}

export default App;
