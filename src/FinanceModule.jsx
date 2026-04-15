import React, { useEffect, useMemo, useState } from 'react';
import { useFinance } from './useFinance';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './FinanceStyles.css';
import logo from './assets/logo.png';

const computeFinanceStats = (transactions = []) => {
  const income = transactions
    .filter((t) => t.type === 'income')
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);

  const expenses = transactions
    .filter((t) => t.type === 'expense')
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);

  const balance = income - expenses;
  const balanceThreshold = income > 0 ? income * 0.2 : 0;

  const categoryMap = {};
  transactions
    .filter((t) => t.type === 'expense')
    .forEach((t) => {
      categoryMap[t.category] = (categoryMap[t.category] || 0) + Number(t.amount || 0);
    });

  let topCategory = 'N/A';
  let maxAmount = 0;
  Object.entries(categoryMap).forEach(([cat, amt]) => {
    if (amt > maxAmount) {
      maxAmount = amt;
      topCategory = cat;
    }
  });

  return {
    income,
    expenses,
    balance,
    totalMovements: transactions.length,
    topCategory,
    lowBalanceSeverity:
      balance <= 0
        ? 'critical'
        : income > 0 && balance <= balanceThreshold
          ? 'warning'
          : 'normal'
  };
};

const monthFormatter = new Intl.DateTimeFormat('es-PY', {
  month: 'long',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('es-PY', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const formatGs = (amount) => `Gs. ${Number(amount || 0).toLocaleString('es-PY')}`;
const formatPercentage = (amount) => `${Number(amount || 0).toFixed(1)}%`;

const getMonthLabel = (monthValue) => {
  if (!monthValue) return 'Sin mes';
  const [year, month] = monthValue.split('-').map(Number);
  if (!year || !month) return monthValue;
  return monthFormatter.format(new Date(year, month - 1, 1));
};

const loadImageAsDataUrl = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('No se pudo preparar el logo para el PDF.'));
        return;
      }

      ctx.drawImage(image, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('No se pudo cargar el logo para el PDF.'));
    image.src = src;
  });

const FinanceModule = () => {
  const { 
    transactions, 
    stats,
    monthlyBudget,
    annualGoal,
    filterYear,
    filterMonth, 
    setFilterMonth, 
    setMonthlyBudget,
    setAnnualGoal,
    addTransaction, 
    deleteTransaction 
  } = useFinance();

  const [formData, setFormData] = useState({
    type: 'expense',
    amount: '',
    date: new Date().toISOString().substring(0, 10),
    category: 'Matrícula',
    description: ''
  });
  const [exportingPdf, setExportingPdf] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [annualGoalInput, setAnnualGoalInput] = useState('');

  const [dashboardStats, setDashboardStats] = useState(() => ({
    ...computeFinanceStats(transactions),
    ...stats,
  }));

  useEffect(() => {
    setDashboardStats({
      ...computeFinanceStats(transactions),
      ...stats,
    });
  }, [transactions, stats]);

  useEffect(() => {
    setBudgetInput(monthlyBudget ? String(monthlyBudget) : '');
  }, [monthlyBudget, filterMonth]);

  useEffect(() => {
    setAnnualGoalInput(annualGoal ? String(annualGoal) : '');
  }, [annualGoal, filterYear]);

  const liveStats = useMemo(() => dashboardStats, [dashboardStats]);

  const balanceAlert =
    liveStats.lowBalanceSeverity === 'critical'
      ? {
          title: 'Saldo comprometido',
          message: 'Los egresos ya alcanzaron o superaron los ingresos del mes. Conviene revisar gastos urgentes.',
          className: 'critical',
        }
      : liveStats.lowBalanceSeverity === 'warning'
        ? {
            title: 'Saldo neto bajo',
            message: 'El saldo disponible ya está por debajo del 20% de los ingresos del mes.',
            className: 'warning',
          }
        : null;

  const financeGridKey = `${liveStats.income}-${liveStats.expenses}-${liveStats.balance}-${liveStats.totalMovements}`;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.amount || !formData.description) return;
    addTransaction(formData);
    setFormData({ ...formData, amount: '', description: '' });
  };

  const handleBudgetSubmit = (e) => {
    e.preventDefault();
    setMonthlyBudget(filterMonth, budgetInput);
  };

  const handleAnnualGoalSubmit = (e) => {
    e.preventDefault();
    setAnnualGoal(filterYear, annualGoalInput);
  };

  const exportToPDF = async () => {
    if (transactions.length === 0) {
      alert("No hay registros en este mes para exportar.");
      return;
    }

    try {
      setExportingPdf(true);

      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const bordo = [128, 0, 32];
      const bordoDark = [92, 10, 33];
      const bordoSoft = [252, 241, 244];
      const grayText = [71, 85, 105];
      const darkText = [30, 41, 59];
      const logoDataUrl = await loadImageAsDataUrl(logo);

      doc.setFillColor(...bordoDark);
      doc.roundedRect(12, 12, pageWidth - 24, 36, 6, 6, 'F');
      doc.setFillColor(...bordo);
      doc.roundedRect(12, 12, pageWidth - 24, 8, 6, 6, 'F');
      doc.addImage(logoDataUrl, 'PNG', 18, 18, 18, 18);

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.text('UNAMIS · Sede Santa Rosa', 40, 25);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text('Reporte institucional de balance y control de gastos', 40, 32);
      doc.setFontSize(10);
      doc.setTextColor(226, 232, 240);
      doc.text(`Mes reportado: ${getMonthLabel(filterMonth)}`, 40, 39);
      doc.text(`Generado: ${dateTimeFormatter.format(new Date())}`, pageWidth - 18, 39, {
        align: 'right',
      });

      const summaryCards = [
        { label: 'Presupuesto mensual', value: formatGs(liveStats.budget) },
        { label: 'Meta anual', value: formatGs(liveStats.annualGoal) },
        { label: 'Ingresos del mes', value: formatGs(liveStats.income) },
        { label: 'Gastos del mes', value: formatGs(liveStats.expenses) },
        { label: 'Saldo neto', value: formatGs(liveStats.balance) },
      ];

      let cardX = 14;
      summaryCards.forEach((card) => {
        doc.setFillColor(...bordoSoft);
        doc.setDrawColor(...bordo);
        doc.setLineWidth(0.9);
        doc.roundedRect(cardX, 56, 43, 24, 4, 4, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...grayText);
        doc.text(card.label.toUpperCase(), cardX + 4, 63);
        doc.setFontSize(12);
        doc.setTextColor(...darkText);
        doc.text(card.value, cardX + 4, 72);
        cardX += 46;
      });

      if (balanceAlert) {
        const isCritical = balanceAlert.className === 'critical';
        doc.setFillColor(...(isCritical ? [255, 241, 242] : [252, 241, 244]));
        doc.setDrawColor(...bordo);
        doc.roundedRect(14, 86, pageWidth - 28, 16, 4, 4, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...bordoDark);
        doc.text(balanceAlert.title, 18, 93);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(balanceAlert.message, 18, 98);
      }

      autoTable(doc, {
        startY: balanceAlert ? 108 : 90,
        head: [['Fecha', 'Tipo', 'Categoría', 'Descripción', 'Monto']],
        body: transactions.map((t) => [
          t.date,
          t.type === 'income' ? 'Ingreso' : 'Gasto',
          t.category,
          t.description,
          `${t.type === 'income' ? '+' : '-'} ${formatGs(t.amount)}`,
        ]),
        theme: 'grid',
        styles: {
          fontSize: 9,
          cellPadding: 4,
          textColor: darkText,
          lineColor: [226, 232, 240],
          lineWidth: 0.2,
        },
        headStyles: {
          fillColor: bordo,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
        columnStyles: {
          4: { halign: 'right' },
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        didDrawPage: () => {
          const pageHeight = doc.internal.pageSize.getHeight();
          doc.setDrawColor(226, 232, 240);
          doc.line(14, pageHeight - 14, pageWidth - 14, pageHeight - 14);
          doc.setFontSize(9);
          doc.setTextColor(...grayText);
          doc.text('Panel interno · UNAMIS · Dirección Sede Santa Rosa', 14, pageHeight - 8);
          doc.text(`Página ${doc.getNumberOfPages()}`, pageWidth - 14, pageHeight - 8, {
            align: 'right',
          });
        },
      });

      doc.save(`Reporte_Finanzas_UNAMIS_${filterMonth}.pdf`);
    } catch (error) {
      console.error('Error al exportar PDF:', error);
      alert('No se pudo exportar el PDF. Intenta nuevamente.');
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="finance-container">
      <div className="moodle-header" style={{ marginBottom: '20px' }}>
        <div>
          <p className="moodle-tag">Administración Financiera</p>
          <h2>Balance y Control de Gastos</h2>
        </div>
        <div className="filter-group" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button 
            onClick={exportToPDF}
            className="memo-action ghost"
            style={{ fontSize: '0.85rem', padding: '8px 15px' }}
            disabled={exportingPdf}
          >
            {exportingPdf ? 'Generando PDF...' : '📥 Exportar PDF'}
          </button>
          <label style={{ marginRight: '10px', fontWeight: 'bold' }}>Filtrar Mes:</label>
          <input 
            type="month" 
            className="form-control" 
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            style={{ width: '200px' }}
          />
        </div>
      </div>

      <section className="finance-budget-panel">
        <div>
          <p className="finance-budget-kicker">Presupuesto del mes</p>
          <h3>{getMonthLabel(filterMonth)}</h3>
          <p className="finance-budget-copy">
            Carga el monto presupuestado para medir cual porcentaje representan los ingresos y egresos.
          </p>
        </div>

        <form className="finance-budget-form" onSubmit={handleBudgetSubmit}>
          <input
            type="number"
            min="0"
            step="0.01"
            className="form-control"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            placeholder="Ej: 15000000"
          />
          <button type="submit" className="btn-submit finance-budget-button">
            Guardar presupuesto
          </button>
        </form>
      </section>

      <section className="finance-budget-panel finance-budget-panel-annual">
        <div>
          <p className="finance-budget-kicker">Meta anual</p>
          <h3>Año {filterYear}</h3>
          <p className="finance-budget-copy">
            Guardá una meta anual para medir el avance acumulado de ingresos y egresos del año seleccionado.
          </p>
        </div>

        <form className="finance-budget-form" onSubmit={handleAnnualGoalSubmit}>
          <input
            type="number"
            min="0"
            step="0.01"
            className="form-control"
            value={annualGoalInput}
            onChange={(e) => setAnnualGoalInput(e.target.value)}
            placeholder="Ej: 180000000"
          />
          <button type="submit" className="btn-submit finance-budget-button">
            Guardar meta anual
          </button>
        </form>
      </section>

      <div className="finance-grid" key={financeGridKey}>
        <div className="stat-card budget">
          <h4>Presupuesto del Mes</h4>
          <div className="value">{formatGs(liveStats.budget)}</div>
          <small>
            Disponible: <strong>{formatGs(liveStats.remainingBudget)}</strong>
          </small>
        </div>
        <div className="stat-card income">
          <h4>Ingresos del Mes</h4>
          <div className="value">Gs. {liveStats.income.toLocaleString()}</div>
          <small>
            {liveStats.budget > 0
              ? `${formatPercentage(liveStats.incomePercentage)} del presupuesto`
              : 'DefinÃ­ un presupuesto para ver porcentaje'}
          </small>
        </div>
        <div className="stat-card expense">
          <h4>Gastos del Mes</h4>
          <div className="value">Gs. {liveStats.expenses.toLocaleString()}</div>
          <small>
            {liveStats.budget > 0
              ? `${formatPercentage(liveStats.expensePercentage)} del presupuesto`
              : 'DefinÃ­ un presupuesto para ver porcentaje'}
          </small>
        </div>
        <div className="stat-card balance">
          <h4>Saldo Neto</h4>
          <div className="value" style={{ color: liveStats.balance >= 0 ? '#10b981' : '#ef4444' }}>
            Gs. {liveStats.balance.toLocaleString()}
          </div>
        </div>
        <div className="stat-card top-cat">
          <h4>Mayor Gasto en</h4>
          <div className="value">{liveStats.topCategory}</div>
          <small>{liveStats.totalMovements} movimientos registrados</small>
        </div>
        <div className="stat-card annual-goal">
          <h4>Meta Anual</h4>
          <div className="value">{formatGs(liveStats.annualGoal)}</div>
          <small>
            Ingresos acumulados: {formatGs(liveStats.annualIncome)}
          </small>
          <small>
            {liveStats.annualGoal > 0
              ? `${formatPercentage(liveStats.annualIncomePercentage)} de avance anual`
              : 'Definí una meta anual para ver avance'}
          </small>
        </div>
        <div className="stat-card annual-expense">
          <h4>Egresos Acumulados</h4>
          <div className="value">{formatGs(liveStats.annualExpenses)}</div>
          <small>
            {liveStats.annualGoal > 0
              ? `${formatPercentage(liveStats.annualExpensePercentage)} respecto a la meta anual`
              : 'Definí una meta anual para comparar'}
          </small>
        </div>
      </div>

      {balanceAlert && (
        <div className={`finance-alert ${balanceAlert.className}`}>
          <strong>{balanceAlert.title}</strong>
          <span>{balanceAlert.message}</span>
        </div>
      )}

      <div className="finance-main-content">
        <section className="finance-form-section">
          <h3>Registrar Movimiento</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Tipo</label>
              <select 
                className="form-control"
                value={formData.type}
                onChange={e => setFormData({...formData, type: e.target.value})}
              >
                <option value="income">Ingreso (+)</option>
                <option value="expense">Gasto (-)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Monto (Gs.)</label>
              <input 
                type="number" 
                className="form-control"
                value={formData.amount}
                onChange={e => setFormData({...formData, amount: e.target.value})}
                placeholder="0"
              />
            </div>
            <div className="form-group">
              <label>Categoría</label>
              <select 
                className="form-control"
                value={formData.category}
                onChange={e => setFormData({...formData, category: e.target.value})}
              >
                <option value="Matrícula">Matrícula</option>
                <option value="Cuotas">Cuotas</option>
                <option value="Constancias">Constancias</option>
                <option value="Técnico Docente">Técnico Docente</option>
                <option value="Catedrático">Catedrático</option>
              </select>
            </div>
            <div className="form-group">
              <label>Fecha</label>
              <input 
                type="date" 
                className="form-control"
                value={formData.date}
                onChange={e => setFormData({...formData, date: e.target.value})}
              />
            </div>
            <div className="form-group">
              <label>Descripción</label>
              <textarea 
                className="form-control"
                value={formData.description}
                onChange={e => setFormData({...formData, description: e.target.value})}
                placeholder="Ej: Pago de electricidad sede"
              />
            </div>
            <button type="submit" className="btn-submit">Guardar Registro</button>
          </form>
        </section>

        <section className="table-container">
          <table className="finance-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Categoría</th>
                <th>Descripción</th>
                <th>Monto</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: '40px' }}>No hay registros para este mes.</td></tr>
              ) : (
                transactions.map(t => (
                  <tr key={t.id}>
                    <td>{t.date}</td>
                    <td><span className="type-badge">{t.category}</span></td>
                    <td>{t.description}</td>
                    <td>
                      <span className={`type-badge ${t.type}`}>
                        {t.type === 'income' ? '+' : '-'} Gs. {Number(t.amount).toLocaleString()}
                      </span>
                    </td>
                    <td>
                      <button 
                        onClick={() => deleteTransaction(t.id)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
};

export default FinanceModule;
