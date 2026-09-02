

function Credentials() {
  return (
    <div className="fade-in">
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1>Credenciais e Integração E-mail</h1>
        <button className="btn btn-primary">+ Nova Credencial</button>
      </div>

      <div className="admin-card" style={{ marginBottom: '2rem' }}>
        <h2>Configuração de API de E-mail (Recepção de PINs)</h2>
        <p style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>
          Configure o provedor de e-mail (ex: Imap, SendGrid Inbound) para que o sistema possa varrer automaticamente a caixa de entrada em busca dos PINs da Netflix/Max e repassar para o Dashboard do Usuário.
        </p>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <input type="text" className="form-group" style={{ padding: '0.5rem', flex: 1, border: '1px solid #ccc', borderRadius: '4px'}} placeholder="Servidor IMAP (ex: imap.gmail.com)" />
          <input type="password" className="form-group" style={{ padding: '0.5rem', flex: 1, border: '1px solid #ccc', borderRadius: '4px'}} placeholder="Senha de App" />
          <button className="btn btn-primary">Testar Conexão</button>
        </div>
      </div>

      <div className="admin-card table-responsive">
        <table className="invoice-table">
          <thead>
            <tr>
              <th>Plataforma</th>
              <th>Conta Matriz</th>
              <th>Senha Atual</th>
              <th>E-mail de Recuperação</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span style={{color: '#E50914', fontWeight: 'bold'}}>Netflix</span></td>
              <td>net1@meusaas.com</td>
              <td>••••••••</td>
              <td>Ativo (IMAP OK)</td>
              <td><button className="btn btn-outline" style={{padding: '0.25rem 0.5rem'}}>Editar</button></td>
            </tr>
            <tr>
              <td><span style={{color: '#002BE7', fontWeight: 'bold'}}>Max</span></td>
              <td>max1@meusaas.com</td>
              <td>••••••••</td>
              <td>Ativo (IMAP OK)</td>
              <td><button className="btn btn-outline" style={{padding: '0.25rem 0.5rem'}}>Editar</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Credentials;
