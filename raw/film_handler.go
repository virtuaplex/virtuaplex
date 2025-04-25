package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/user/virtuaplex/models"
	"github.com/user/virtuaplex/services"
)

// FilmHandler handles film-related requests
type FilmHandler struct {
	filmService  *services.FilmService
	omdbService  *services.OmdbService
}

// NewFilmHandler creates a new film handler
func NewFilmHandler(filmService *services.FilmService, omdbService *services.OmdbService) *FilmHandler {
	return &FilmHandler{
		filmService: filmService,
		omdbService: omdbService,
	}
}

// SearchOMDB searches for films in OMDB
func (h *FilmHandler) SearchOMDB(c *gin.Context) {
	// Get operator ID from context (set by auth middleware)
	operatorID, exists := c.Get("operatorID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	title := c.Query("title")
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Title is required"})
		return
	}

	year, _ := strconv.Atoi(c.Query("year"))
	mediaType := c.Query("type")

	// Validate mediaType
	if mediaType != "" && mediaType != "movie" && mediaType != "series" && mediaType != "episode" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid type"})
		return
	}

	// Search OMDB
	results, err := h.omdbService.Search(title, year, mediaType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("OMDB search failed: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"results": results})
}

// GetOMDBDetails gets detailed information about a film from OMDB
func (h *FilmHandler) GetOMDBDetails(c *gin.Context) {
	// Get operator ID from context (set by auth middleware)
	operatorID, exists := c.Get("operatorID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	omdbID := c.Param("omdb_id")
	if omdbID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "OMDB ID is required"})
		return
	}

	// Get movie details from OMDB
	movie, err := h.omdbService.GetByID(omdbID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("OMDB lookup failed: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"omdb_data": movie})
}

// CreateFilm creates a new film
func (h *FilmHandler) CreateFilm(c *gin.Context) {
	// Get operator ID from context (set by auth middleware)
	operatorID, exists := c.Get("operatorID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var filmRequest models.FilmCreateRequest
	if err := c.ShouldBindJSON(&filmRequest); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request: %v", err)})
		return
	}

	// Validate required fields
	if filmRequest.Title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Title is required"})
		return
	}

	if filmRequest.DurationMinutes <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Duration must be greater than 0"})
		return
	}

	if filmRequest.MagnetLink == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Magnet link is required"})
		return
	}

	// If OMDB ID is provided, get data from OMDB
	var omdbData *services.OmdbMovie
	if filmRequest.OmdbID != "" {
		var err error
		omdbData, err = h.omdbService.GetByID(filmRequest.OmdbID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("OMDB lookup failed: %v", err)})
			return
		}

		// Populate film data from OMDB if fields are not provided
		if filmRequest.Description == "" {
			filmRequest.Description = omdbData.Plot
		}

		if filmRequest.ReleaseYear == 0 {
			filmRequest.ReleaseYear, _ = strconv.Atoi(omdbData.Year)
		}

		if filmRequest.PosterURL == "" {
			filmRequest.PosterURL = omdbData.Poster
		}

		if filmRequest.Genre == "" {
			filmRequest.Genre = omdbData.Genre
		}

		if filmRequest.Director == "" {
			filmRequest.Director = omdbData.Director
		}

		// Add OMDB metadata if not provided
		if len(filmRequest.Metadata) == 0 {
			filmRequest.Metadata = []models.FilmMetadata{
				{Key: "actors", Value: omdbData.Actors},
				{Key: "language", Value: omdbData.Language},
				{Key: "country", Value: omdbData.Country},
				{Key: "rated", Value: omdbData.Rated},
				{Key: "awards", Value: omdbData.Awards},
				{Key: "imdb_rating", Value: omdbData.ImdbRating},
				{Key: "imdb_votes", Value: omdbData.ImdbVotes},
				{Key: "box_office", Value: omdbData.BoxOffice},
			}
		}
	}

	// Create the film
	film, err := h.filmService.CreateFilm(filmRequest, operatorID.(int))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to create film: %v", err)})
		return
	}

	// Include OMDB data in the response if available
	responseData := gin.H{
		"id":               film.ID,
		"title":            film.Title,
		"omdb_id":          film.OmdbID,
		"description":      film.Description,
		"release_year":     film.ReleaseYear,
		"duration_minutes": film.DurationMinutes,
		"magnet_link":      film.MagnetLink,
		"poster_url":       film.PosterURL,
		"genre":            film.Genre,
		"director":         film.Director,
		"is_public_domain": film.IsPublicDomain,
		"added_by":         film.AddedBy,
		"added_at":         film.AddedAt,
		"metadata":         film.Metadata,
	}

	if omdbData != nil {
		responseData["omdb_data"] = omdbData
	}

	c.JSON(http.StatusCreated, responseData)
}

// UpdateFilm updates an existing film
func (h *FilmHandler) UpdateFilm(c *gin.Context) {
	// Get operator ID from context (set by auth middleware)
	operatorID, exists := c.Get("operatorID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	filmID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid film ID"})
		return
	}

	var filmRequest models.FilmUpdateRequest
	if err := c.ShouldBindJSON(&filmRequest); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request: %v", err)})
		return
	}

	// Check if film exists and operator has permission
	existingFilm, err := h.filmService.GetFilmByID(filmID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Film not found"})
		return
	}

	// If sync_with_omdb is true and we have an OMDB ID, refresh data from OMDB
	var omdbData *services.OmdbMovie
	if filmRequest.SyncWithOmdb && (existingFilm.OmdbID != "" || filmRequest.OmdbID != "") {
		omdbID := filmRequest.OmdbID
		if omdbID == "" {
			omdbID = existingFilm.OmdbID
		}

		omdbData, err = h.omdbService.GetByID(omdbID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("OMDB lookup failed: %v", err)})
			return
		}

		// Update film data from OMDB
		filmRequest.OmdbID = omdbData.ImdbID
		filmRequest.Title = omdbData.Title
		filmRequest.Description = omdbData.Plot
		filmRequest.ReleaseYear, _ = strconv.Atoi(omdbData.Year)
		filmRequest.PosterURL = omdbData.Poster
		filmRequest.Genre = omdbData.Genre
		filmRequest.Director = omdbData.Director

		// Runtime parsing
		var runtimeMin int
		fmt.Sscanf(omdbData.Runtime, "%d min", &runtimeMin)
		if runtimeMin > 0 {
			filmRequest.DurationMinutes = runtimeMin
		}

		// Add OMDB metadata
		var metadataToAdd []models.FilmMetadata
		metadataToAdd = append(metadataToAdd, models.FilmMetadata{Key: "actors", Value: omdbData.Actors})
		metadataToAdd = append(metadataToAdd, models.FilmMetadata{Key: "language", Value: omdbData.Language})
		metadataToAdd = append(metadataToAdd, models.FilmMetadata{Key: "country", Value: omdbData.Country})
		metadataToAdd = append(metadataToAdd, models.FilmMetadata{Key: "rated", Value: omdbData.Rated})
		metadataToAdd = append(metadataToAdd, models.FilmMetadata{Key: "awards", Value: omdbData.Awards})
		metadataToAdd = append(metadataToAdd, models.FilmMetadata{Key: "imdb_rating", Value: omdbData.ImdbRating})
		metadataToAdd = append(metadataToAdd, models.FilmMetadata{Key: "imdb_votes", Value: omdbData.ImdbVotes})
		metadataToAdd = append(metadataToAdd, models.FilmMetadata{Key: "box_office", Value: omdbData.BoxOffice})

		// If we're syncing with OMDB, replace all metadata
		if filmRequest.SyncWithOmdb {
			filmRequest.Metadata = metadataToAdd
		} else if len(filmRequest.Metadata) == 0 {
			// Otherwise, add OMDB metadata only if no metadata was provided
			filmRequest.Metadata = metadataToAdd
		}
	}

	// Update the film
	updatedFilm, err := h.filmService.UpdateFilm(filmID, filmRequest, operatorID.(int))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to update film: %v", err)})
		return
	}

	// Include OMDB data in the response if available
	responseData := gin.H{
		"id":               updatedFilm.ID,
		"title":            updatedFilm.Title,
		"omdb_id":          updatedFilm.OmdbID,
		"description":      updatedFilm.Description,
		"release_year":     updatedFilm.ReleaseYear,
		"duration_minutes": updatedFilm.DurationMinutes,
		"magnet_link":      updatedFilm.MagnetLink,
		"poster_url":       updatedFilm.PosterURL,
		"genre":            updatedFilm.Genre,
		"director":         updatedFilm.Director,
		"is_public_domain": updatedFilm.IsPublicDomain,
		"added_by":         updatedFilm.AddedBy,
		"added_at":         updatedFilm.AddedAt,
		"metadata":         updatedFilm.Metadata,
	}

	if omdbData != nil {
		responseData["omdb_data"] = omdbData
	}

	c.JSON(http.StatusOK, responseData)
}