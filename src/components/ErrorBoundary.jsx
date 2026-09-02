import { Component } from 'react';
import { Link } from 'react-router-dom';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0D1117',
          color: '#E6EDF3',
          fontFamily: 'system-ui, sans-serif',
          padding: '2rem',
          textAlign: 'center',
        }}>
          <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>Algo deu errado</h2>
            <p style={{ color: '#8B949E', marginBottom: '1.5rem', maxWidth: 400 }}>
              Ocorreu um erro inesperado. Tente recarregar a página.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '0.6rem 1.5rem',
                  background: '#4F46E5',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Recarregar
              </button>
              <Link
                to="/dashboard"
                style={{
                  padding: '0.6rem 1.5rem',
                  background: 'transparent',
color: '#4F46E5',
                   border: '1px solid #4F46E5',
                  borderRadius: '0.5rem',
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                Voltar ao Início
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
