import { userResolvers } from './users.js';
import { companyResolvers } from './companies.js';
import { eventResolvers } from './events.js';
import { salesResolvers } from './sales.js';
import { laborResolvers } from './labor.js';
import { expenseResolvers } from './expenses.js';
import { adminResolvers } from './admin.js';
import { recipeResolvers } from './recipes.js';
import { inventoryResolvers } from './inventory.js';

export const resolvers = {
  Query: {
    ...userResolvers.Query,
    ...companyResolvers.Query,
    ...eventResolvers.Query,
    ...salesResolvers.Query,
    ...laborResolvers.Query,
    ...adminResolvers.Query,
    ...recipeResolvers.Query,
    ...inventoryResolvers.Query,
  },
  Mutation: {
    ...companyResolvers.Mutation,
    ...eventResolvers.Mutation,
    ...salesResolvers.Mutation,
    ...laborResolvers.Mutation,
    ...expenseResolvers.Mutation,
    ...adminResolvers.Mutation,
    ...recipeResolvers.Mutation,
    ...inventoryResolvers.Mutation,
  },
  Company: companyResolvers.Company,
  Permit: eventResolvers.Permit,
};
