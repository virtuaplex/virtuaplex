// React component for OMDB film search
import React, { useState } from 'react';
import axios from 'axios';

const OmdbSearch = ({ onSelect }) => {
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('');
  const [type, setType] = useState('movie');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const searchOmdb = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams();
      params.append('title', query);
      if (year) params.append('year', year);
      params.append('type', type);
      
      const response = await axios.get(`/api/films/search/omdb?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      setResults(response.data.results.Search || []);
      
      if (response.data.results.Error) {
        setError(response.data.results.Error);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'An error occurred during search');
    } finally {
      setLoading(false);
    }
  };

  const getDetails = async (omdbId) => {
    try {
      const response = await axios.get(`/api/films/omdb/${omdbId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      const movie = response.data.omdb_data;
      setSelected(movie);
      
      if (onSelect) {
        onSelect(movie);
      }
    } catch (err) {
      setError('Failed to get movie details');
    }
  };

  return (
    <div className="omdb-search">
      <h2>Search for Films in OMDB</h2>
      
      <form onSubmit={searchOmdb}>
        <div className="form-group">
          <label htmlFor="query">Title</label>
          <input
            type="text"
            id="query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            required
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="year">Year (Optional)</label>
          <input
            type="number"
            id="year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="type">Type</label>
          <select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="movie">Movie</option>
            <option value="series">Series</option>
            <option value="episode">Episode</option>
          </select>
        </div>
        
        <button type="submit" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>
      
      {error && <div className="error">{error}</div>}
      
      <div className="results">
        {results.length > 0 ? (
          <div>
            <h3>Search Results</h3>
            <ul className="omdb-results">
              {results.map((movie) => (
                <li key={movie.imdbID} onClick={() => getDetails(movie.imdbID)}>
                  <div className="movie-card">
                    {movie.Poster !== 'N/A' ? (
                      <img src={movie.Poster} alt={movie.Title} />
                    ) : (
                      <div className="no-poster">No Poster</div>
                    )}
                    <div className="movie-info">
                      <h4>{movie.Title}</h4>
                      <p>{movie.Year} • {movie.Type}</p>
                      <button>Select</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : results.length === 0 && !loading && !error ? (
          <p>No results found. Try a different search.</p>
        ) : null}
      </div>
      
      {selected && (
        <div className="selected-movie">
          <h3>Selected Movie</h3>
          <div className="movie-details">
            <img src={selected.Poster} alt={selected.Title} />
            <div>
              <h4>{selected.Title} ({selected.Year})</h4>
              <p><strong>Director:</strong> {selected.Director}</p>
              <p><strong>Genre:</strong> {selected.Genre}</p>
              <p><strong>Runtime:</strong> {selected.Runtime}</p>
              <p><strong>IMDB Rating:</strong> {selected.imdbRating}/10</p>
              <p>{selected.Plot}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OmdbSearch;