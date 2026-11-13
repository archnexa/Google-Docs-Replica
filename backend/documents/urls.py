from django.urls import path

from documents import views

urlpatterns = [
    path("", views.DocumentListView.as_view(), name="document-list"),
    path("<uuid:doc_id>/", views.DocumentDetailView.as_view(), name="document-detail"),
    path("<uuid:doc_id>/content/", views.DocumentContentView.as_view(), name="document-content"),
]
