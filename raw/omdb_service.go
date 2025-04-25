package services

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
)

// OmdbService handles integration with the Open Movie Database API
type OmdbService struct {
	ApiKey string
	BaseURL string
}

// OmdbMovie represents a movie from the OMDB API
type OmdbMovie struct {
	Title      string `json:"Title"`
	Year       string `json:"Year"`
	Rated      string `json:"Rated"`
	Released   string `json:"Released"`
	Runtime    string `json:"Runtime"`
	Genre      string `json:"Genre"`
	Director   string `json:"Director"`
	Writer     string `json:"Writer"`
	Actors     string `json:"Actors"`
	Plot       string `json:"Plot"`
	Language   string `json:"Language"`
	Country    string `json:"Country"`
	Awards     string `json:"Awards"`
	Poster     string `json:"Poster"`
	Ratings    []OmdbRating `json:"Ratings"`
	Metascore  string `json:"Metascore"`
	ImdbRating string `json:"imdbRating"`
	ImdbVotes  string `json:"imdbVotes"`
	ImdbID     string `json:"imdbID"`
	Type       string `json:"Type"`
	DVD        string `json:"DVD"`
	BoxOffice  string `json:"BoxOffice"`
	Production string `json:"Production"`
	Website    string `json:"Website"`
	Response   string `json:"Response"`
}

// OmdbRating represents a rating for a movie from OMDB
type OmdbRating struct {
	Source string `json:"Source"`
	Value  string `json:"Value"`
}

// OmdbSearchResult represents the result of a search query to OMDB
type OmdbSearchResult struct {
	Search       []OmdbSearchItem `json:"Search"`
	TotalResults string           `json:"totalResults"`
	Response     string           `json:"Response"`
	Error        string           `json:"Error,omitempty"`
}

// OmdbSearchItem represents a single item in a search result from OMDB
type OmdbSearchItem struct {
	Title  string `json:"Title"`
	Year   string `json:"Year"`
	ImdbID string `json:"imdbID"`
	Type   string `json:"Type"`
	Poster string `json:"Poster"`
}

// NewOmdbService creates a new OMDB service
func NewOmdbService() *OmdbService {
	return &OmdbService{
		ApiKey: os.Getenv("OMDB_API_KEY"),
		BaseURL: "http://www.omdbapi.com/",
	}
}

// Search searches for movies by title
func (s *OmdbService) Search(title string, year int, mediaType string) (*OmdbSearchResult, error) {
	params := url.Values{}
	params.Add("apikey", s.ApiKey)
	params.Add("s", title)
	
	if year > 0 {
		params.Add("y", strconv.Itoa(year))
	}
	
	if mediaType != "" {
		params.Add("type", mediaType)
	}
	
	requestURL := fmt.Sprintf("%s?%s", s.BaseURL, params.Encode())
	resp, err := http.Get(requestURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	var result OmdbSearchResult
	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		return nil, err
	}
	
	return &result, nil
}

// GetByID gets a movie by its IMDB ID
func (s *OmdbService) GetByID(imdbID string) (*OmdbMovie, error) {
	params := url.Values{}
	params.Add("apikey", s.ApiKey)
	params.Add("i", imdbID)
	params.Add("plot", "full")
	
	requestURL := fmt.Sprintf("%s?%s", s.BaseURL, params.Encode())
	resp, err := http.Get(requestURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	var movie OmdbMovie
	err = json.NewDecoder(resp.Body).Decode(&movie)
	if err != nil {
		return nil, err
	}
	
	// Check if response was successful
	if movie.Response == "False" {
		return nil, fmt.Errorf("OMDB error: movie not found")
	}
	
	return &movie, nil
}

// GetByTitle gets a movie by its title
func (s *OmdbService) GetByTitle(title string, year int) (*OmdbMovie, error) {
	params := url.Values{}
	params.Add("apikey", s.ApiKey)
	params.Add("t", title)
	params.Add("plot", "full")
	
	if year > 0 {
		params.Add("y", strconv.Itoa(year))
	}
	
	requestURL := fmt.Sprintf("%s?%s", s.BaseURL, params.Encode())
	resp, err := http.Get(requestURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	
	var movie OmdbMovie
	err = json.NewDecoder(resp.Body).Decode(&movie)
	if err != nil {
		return nil, err
	}
	
	// Check if response was successful
	if movie.Response == "False" {
		return nil, fmt.Errorf("OMDB error: movie not found")
	}
	
	return &movie, nil
}

// ConvertToFilmData converts OMDB movie data to Film data structure
func (s *OmdbService) ConvertToFilmData(movie *OmdbMovie) map[string]interface{} {
	// Extract runtime minutes from string like "120 min"
	runtimeStr := movie.Runtime
	var runtimeMin int
	fmt.Sscanf(runtimeStr, "%d min", &runtimeMin)
	
	// Extract year and convert to integer
	year, _ := strconv.Atoi(movie.Year)
	
	return map[string]interface{}{
		"title":           movie.Title,
		"omdb_id":         movie.ImdbID,
		"description":     movie.Plot,
		"release_year":    year,
		"duration_minutes": runtimeMin,
		"poster_url":      movie.Poster,
		"genre":           movie.Genre,
		"director":        movie.Director,
		"metadata": []map[string]string{
			{"key": "actors", "value": movie.Actors},
			{"key": "language", "value": movie.Language},
			{"key": "country", "value": movie.Country},
			{"key": "rated", "value": movie.Rated},
			{"key": "awards", "value": movie.Awards},
			{"key": "imdb_rating", "value": movie.ImdbRating},
			{"key": "box_office", "value": movie.BoxOffice},
		},
	}
}