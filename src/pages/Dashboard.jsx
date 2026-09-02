import { Link } from 'react-router-dom';
import './Dashboard.css';

function Dashboard() {
  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <div className="logo">Divide<span>Pass</span></div>
        <nav className="nav-menu">
          <Link to="/dashboard" className="nav-item active">Visão Geral</Link>
          <Link to="#" className="nav-item">Grupos</Link>
          <Link to="#" className="nav-item">Despesas</Link>
          <Link to="#" className="nav-item">Configurações</Link>
        </nav>
        <div className="sidebar-footer">
          <Link to="/login" className="nav-item logout">Sair</Link>
        </div>
      </aside>
      
      <main className="main-content">
        <header className="topbar">
          <h2>Bem-vindo, João!</h2>
          <div className="user-profile">
            <div className="avatar">J</div>
          </div>
        </header>

        <div className="dashboard-grid">
          <div className="stat-card">
            <h3>Total a Pagar</h3>
            <p className="amount amount-negative">R$ 120,50</p>
          </div>
          <div className="stat-card">
            <h3>Total a Receber</h3>
            <p className="amount amount-positive">R$ 45,00</p>
          </div>
          <div className="stat-card">
            <h3>Saldo Geral</h3>
            <p className="amount">R$ -75,50</p>
          </div>
        </div>

        <div className="recent-activity">
          <h3>Atividades Recentes</h3>
          <div className="activity-list">
            <div className="activity-item">
              <div className="activity-icon pizza">🍕</div>
              <div className="activity-details">
                <h4>Pizza de Sexta</h4>
                <p>Você deve R$ 35,00 para Maria</p>
              </div>
              <span className="activity-time">Hoje</span>
            </div>
            <div className="activity-item">
              <div className="activity-icon uber">🚗</div>
              <div className="activity-details">
                <h4>Uber para a Festa</h4>
                <p>Carlos deve R$ 15,00 para você</p>
              </div>
              <span className="activity-time">Ontem</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
