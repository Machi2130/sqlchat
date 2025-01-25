/**
 * SQL Chat Bot Frontend
 * React application for natural language SQL query interface
 */

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './App.css';

// Components
const DatabaseSelector = ({ value, options, onChange }) => (
    <div className="database-selector">
        <select 
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="database-select"
        >
            <option value="">Select Database</option>
            {options.map((db) => (
                <option key={db} value={db}>{db}</option>
            ))}
        </select>
    </div>
);

const QueryInput = ({ value, onChange, disabled, onSubmit, loading }) => (
    <div className="query-section">
        <textarea
            className="query-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter your query in natural language..."
            disabled={disabled}
        />
        <button 
            className="execute-button"
            onClick={onSubmit}
            disabled={loading || disabled}
        >
            {loading ? 'Executing...' : 'Execute Query'}
        </button>
    </div>
);

const ResultsTable = ({ results }) => {
    if (!results?.length) return null;
    
    return (
        <div className="results-table">
            <table>
                <thead>
                    <tr>
                        {Object.keys(results[0]).map((key) => (
                            <th key={key}>{key}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {results.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            {Object.values(row).map((value, colIndex) => (
                                <td key={colIndex}>{value}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const SchemaViewer = ({ columns }) => (
    <div className="schema-viewer">
        {Object.entries(columns).map(([table, cols]) => (
            <div key={table} className="table-info">
                <h3>{table}</h3>
                <ul className="column-list">
                    {cols.map((col, index) => (
                        <li key={index}>{col}</li>
                    ))}
                </ul>
            </div>
        ))}
    </div>
);

const ErrorDisplay = ({ message }) => (
    message ? (
        <div className="error-message">
            {message}
        </div>
    ) : null
);

const App = () => {
    // State management
    const [selectedDatabase, setSelectedDatabase] = useState('');
    const [databases, setDatabases] = useState([]);
    const [columns, setColumns] = useState({});
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Fetch databases on mount
    useEffect(() => {
        const fetchDatabases = async () => {
            try {
                const response = await axios.get('http://localhost:3002/api/databases');
                setDatabases(response.data.databases);
            } catch (err) {
                setError('Failed to fetch databases');
                console.error('Database fetch error:', err);
            }
        };
        fetchDatabases();
    }, []);

    // Fetch columns when database is selected
    useEffect(() => {
        const fetchColumns = async () => {
            if (selectedDatabase) {
                try {
                    const response = await axios.get(
                        `http://localhost:3002/api/columns?database=${selectedDatabase}`
                    );
                    setColumns(response.data.columns);
                } catch (err) {
                    setError('Failed to fetch database schema');
                    console.error('Schema fetch error:', err);
                }
            }
        };
        fetchColumns();
    }, [selectedDatabase]);

    // Query execution handler
    const handleQuery = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await axios.post('http://localhost:3002/api/query', {
                query,
                database: selectedDatabase
            });
            setResults(response.data.results);
            console.log('Generated SQL:', response.data.query);
        } catch (err) {
            const errorMessage = err.response?.data?.error || 'Query execution failed';
            setError(errorMessage);
            console.error('Query error:', errorMessage);
            setResults(null);
        } finally {
            setLoading(false);
        }
    }, [query, selectedDatabase]);

    return (
        <div className="app-container">
            <nav className="navbar">
                <h1>SQL Query Assistant</h1>
                <DatabaseSelector 
                    value={selectedDatabase}
                    options={databases}
                    onChange={setSelectedDatabase}
                />
            </nav>

            <div className="main-content">
                <QueryInput 
                    value={query}
                    onChange={setQuery}
                    disabled={!selectedDatabase}
                    onSubmit={handleQuery}
                    loading={loading}
                />

                <ErrorDisplay message={error} />

                {results && (
                    <div className="results-container">
                        <ResultsTable results={results} />
                    </div>
                )}
            </div>

            <div className="sidebar">
                <h2>Database Structure</h2>
                <SchemaViewer columns={columns} />
            </div>
        </div>
    );
};

export default App;
