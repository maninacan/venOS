import { useParams } from 'react-router-dom';
import { useQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';

const GET_COMPANY = gql`
  query GetCompany($id: ID!) {
    company(id: $id) {
      id name plan joinCode vendorCategory posSystem laborMethod currency defaultCountry
      posStatus { connected provider locationName }
    }
  }
`;

export function useCurrentCompany() {
  const { companyId } = useParams<{ companyId: string }>();

  const { data, loading, error } = useQuery(GET_COMPANY, {
    variables: { id: companyId },
    skip: !companyId,
  });

  return {
    companyId: companyId ?? null,
    company: data?.company ?? null,
    loading,
    error,
  };
}
