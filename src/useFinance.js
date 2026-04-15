import { useState, useEffect } from 'react';

const STORAGE_KEY = 'unamis_finance_data';
const BUDGET_STORAGE_KEY = 'unamis_finance_budget_data';
const ANNUAL_GOAL_STORAGE_KEY = 'unamis_finance_annual_goal_data';

const normalizeTransactionDate = (value = '') => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const slashMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month}-${day}`;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return value;

  return parsedDate.toISOString().substring(0, 10);
};

const normalizeTransaction = (transaction) => ({
  ...transaction,
  amount: Number(transaction?.amount || 0),
  date: normalizeTransactionDate(transaction?.date || ''),
  type: transaction?.type === 'income' ? 'income' : 'expense',
});

const matchesFilterMonth = (date = '', filterMonth = '') =>
  normalizeTransactionDate(date).startsWith(filterMonth);

const getYearFromMonth = (monthValue = '') => String(monthValue || '').slice(0, 4);

export const useFinance = () => {
  const [transactions, setTransactions] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).map(normalizeTransaction) : [];
  });
  const [budgetsByMonth, setBudgetsByMonth] = useState(() => {
    const saved = localStorage.getItem(BUDGET_STORAGE_KEY);

    if (!saved) return {};

    try {
      const parsed = JSON.parse(saved);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });
  const [annualGoalsByYear, setAnnualGoalsByYear] = useState(() => {
    const saved = localStorage.getItem(ANNUAL_GOAL_STORAGE_KEY);

    if (!saved) return {};

    try {
      const parsed = JSON.parse(saved);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });

  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().substring(0, 7));
  const filterYear = getYearFromMonth(filterMonth);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(budgetsByMonth));
  }, [budgetsByMonth]);

  useEffect(() => {
    localStorage.setItem(ANNUAL_GOAL_STORAGE_KEY, JSON.stringify(annualGoalsByYear));
  }, [annualGoalsByYear]);

  const filteredTransactions = transactions.filter((t) =>
    matchesFilterMonth(t.date, filterMonth)
  );
  const filteredYearTransactions = transactions.filter((t) =>
    normalizeTransactionDate(t.date).startsWith(filterYear)
  );

  const income = filteredTransactions
    .filter((t) => t.type === 'income')
    .reduce((acc, t) => acc + Number(t.amount), 0);

  const expenses = filteredTransactions
    .filter((t) => t.type === 'expense')
    .reduce((acc, t) => acc + Number(t.amount), 0);

  const balance = income - expenses;
  const balanceThreshold = income > 0 ? income * 0.2 : 0;
  const budget = Number(budgetsByMonth[filterMonth] || 0);
  const remainingBudget = budget - expenses;
  const incomePercentage = budget > 0 ? (income / budget) * 100 : 0;
  const expensePercentage = budget > 0 ? (expenses / budget) * 100 : 0;
  const annualGoal = Number(annualGoalsByYear[filterYear] || 0);
  const annualIncome = filteredYearTransactions
    .filter((t) => t.type === 'income')
    .reduce((acc, t) => acc + Number(t.amount), 0);
  const annualExpenses = filteredYearTransactions
    .filter((t) => t.type === 'expense')
    .reduce((acc, t) => acc + Number(t.amount), 0);
  const annualIncomePercentage = annualGoal > 0 ? (annualIncome / annualGoal) * 100 : 0;
  const annualExpensePercentage = annualGoal > 0 ? (annualExpenses / annualGoal) * 100 : 0;

  const categoryMap = {};
  filteredTransactions
    .filter((t) => t.type === 'expense')
    .forEach((t) => {
      categoryMap[t.category] = (categoryMap[t.category] || 0) + Number(t.amount);
    });

  let topCategory = "N/A";
  let maxAmount = 0;
  Object.entries(categoryMap).forEach(([cat, amt]) => {
    if (amt > maxAmount) {
      maxAmount = amt;
      topCategory = cat;
    }
  });

  const stats = {
    budget,
    income,
    expenses,
    balance,
    remainingBudget,
    incomePercentage,
    expensePercentage,
    annualGoal,
    annualIncome,
    annualExpenses,
    annualIncomePercentage,
    annualExpensePercentage,
    totalMovements: filteredTransactions.length,
    topCategory,
    lowBalanceSeverity:
      balance <= 0
        ? 'critical'
        : income > 0 && balance <= balanceThreshold
          ? 'warning'
          : 'normal'
  };

  const addTransaction = (data) => {
    const newTransaction = normalizeTransaction({
      ...data,
      id: Date.now(),
    });
    setTransactions(prev => [newTransaction, ...prev]);
  };

  const deleteTransaction = (id) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
  };

  const setMonthlyBudget = (month, amount) => {
    if (!month) return;

    const normalizedAmount = Math.max(0, Number(amount) || 0);

    setBudgetsByMonth((prev) => ({
      ...prev,
      [month]: normalizedAmount,
    }));
  };

  const setAnnualGoal = (year, amount) => {
    if (!year) return;

    const normalizedAmount = Math.max(0, Number(amount) || 0);

    setAnnualGoalsByYear((prev) => ({
      ...prev,
      [year]: normalizedAmount,
    }));
  };

  return {
    transactions: filteredTransactions,
    allTransactions: transactions,
    stats,
    monthlyBudget: Number(budgetsByMonth[filterMonth] || 0),
    annualGoal: Number(annualGoalsByYear[filterYear] || 0),
    filterYear,
    filterMonth,
    setFilterMonth,
    setMonthlyBudget,
    setAnnualGoal,
    addTransaction,
    deleteTransaction
  };
};
